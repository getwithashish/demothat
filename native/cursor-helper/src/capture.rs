// The PipeWire half: turn the portal's stream into two useful things — raw video
// frames on a file descriptor (the app pipes them into its bundled FFmpeg, so no
// encoder is needed here and nothing is encoded twice), and cursor samples on
// stdout.
//
// Three deliberate choices:
//
//   * **Software memory only.** We ask for MemFd/MemPtr buffers, never DMA-BUF, so
//     the frames are readable on any machine, with or without a GPU. The cost is a
//     copy inside the compositor; the benefit is that the helper needs no
//     EGL/GBM stack and works on a GPU-less box.
//   * **The pointer is not in the pixels.** The session asks for METADATA cursor
//     mode, so the position arrives in each buffer's cursor meta and the app draws
//     the cursor itself. Reading that meta is why this module drops to the raw
//     `pipewire-sys` bindings: `pipewire` 0.8's safe `Buffer` exposes only its data
//     slices, and the cursor meta is not among them. The SPA ABI below is copied
//     from `/usr/include/spa-0.2/spa/buffer/meta.h`.
//   * **Raw frames leave on a descriptor**, not through a codec in this process,
//     which keeps the helper free of FFmpeg and means the app keeps using the
//     bundled binary it already ships.

use crate::protocol::{now_ms, Control, Emitter, Event};
use anyhow::{Context, Result};
use pipewire as pw;
use pipewire_sys as pw_sys;
use pw::spa;
use pw::spa::pod::{serialize::PodSerializer, Object, Pod, Property, Value};
use pw::spa::utils::Id;
use std::os::fd::{AsRawFd, BorrowedFd, OwnedFd, RawFd};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::{Arc, Mutex};

/// `spa_meta_type::SPA_META_Cursor` — the fifth entry of the enum, which bindgen
/// does not emit for us.
const SPA_META_CURSOR: u32 = 5;

#[repr(C)]
#[derive(Clone, Copy)]
struct SpaPoint {
    x: i32,
    y: i32,
}

/// `struct spa_meta`: the header of one meta region on a buffer.
#[repr(C)]
#[derive(Clone, Copy)]
struct SpaMeta {
    type_: u32,
    size: u32,
    data: *mut std::ffi::c_void,
}

/// `struct spa_meta_cursor`. `id == 0` means "no new cursor data", so a stale
/// buffer must not be read as a position at 0,0.
#[repr(C)]
#[derive(Clone, Copy)]
struct SpaMetaCursor {
    id: u32,
    flags: u32,
    position: SpaPoint,
    hotspot: SpaPoint,
    bitmap_offset: u32,
}

/// Cursor state as the last frame reported it, plus the clicks waiting to be
/// emitted. Clicks come from evdev and carry no coordinates of their own, so they
/// are stamped with the most recent position the portal gave us.
#[derive(Default)]
pub struct CursorState {
    pub x: f64,
    pub y: f64,
    pub have_position: bool,
}

pub struct CaptureStats {
    pub frames: AtomicU64,
    pub dropped: AtomicU64,
}

struct UserData {
    events: Emitter<std::io::Stdout>,
    video_fd: RawFd,
    stats: Arc<CaptureStats>,
    cursor: Arc<Mutex<CursorState>>,
    clicks: Receiver<(String, bool)>,
    started: bool,
    frames_without_cursor: u64,
    format_name: String,
    width: u32,
    height: u32,
    paused: Arc<AtomicBool>,
    /// Set by the control thread; the loop notices it on the next frame and stops
    /// from the inside, which is the only thread-safe way to do it.
    stop: Arc<AtomicBool>,
    main_loop: pw::main_loop::MainLoop,
    cursor_is_metadata: bool,
    clicks_available: bool,
}

impl UserData {
    fn emit_cursor_and_clicks(&mut self) {
        if self.paused.load(Ordering::Relaxed) {
            return;
        }
        let (position, have) = {
            let state = self.cursor.lock().unwrap();
            ((state.x, state.y), state.have_position)
        };
        if have {
            self.events.emit(Event::Move {
                timestamp: now_ms(),
                x: position.0,
                y: position.1,
            });
        }

        // Drained every frame: an empty channel is the normal case.
        loop {
            match self.clicks.try_recv() {
                Ok((button, pressed)) => self.events.emit(Event::Click {
                    timestamp: now_ms(),
                    x: position.0,
                    y: position.1,
                    button,
                    pressed,
                }),
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
            }
        }
    }
}

/// Reads the pointer position out of a raw `spa_buffer`.
///
/// The compositor puts a `spa_meta_cursor` in the buffer's meta region. Its
/// `position` is the cursor bitmap's top-left and `hotspot` the offset of the
/// actual pointer tip inside it, so the pointer sits at their sum.
unsafe fn read_cursor_meta(buffer: *mut spa::sys::spa_buffer) -> Option<(f64, f64)> {
    if buffer.is_null() {
        return None;
    }
    let count = (*buffer).n_metas as usize;
    if (*buffer).metas.is_null() || count == 0 {
        return None;
    }
    for index in 0..count {
        let meta = (*buffer).metas.add(index) as *const SpaMeta;
        if (*meta).type_ != SPA_META_CURSOR {
            continue;
        }
        if (*meta).data.is_null() || ((*meta).size as usize) < std::mem::size_of::<SpaMetaCursor>()
        {
            continue;
        }
        let cursor = (*meta).data as *const SpaMetaCursor;
        if (*cursor).id == 0 {
            // No new cursor data in this buffer; the last position still stands,
            // so report nothing and let the caller keep its previous sample.
            return None;
        }
        return Some((
            f64::from((*cursor).position.x + (*cursor).hotspot.x),
            f64::from((*cursor).position.y + (*cursor).hotspot.y),
        ));
    }
    None
}

/// The pixel format we ask for, as FFmpeg spells it. The raw frames go straight
/// into FFmpeg over a pipe, so the app needs this string to build its arguments.
fn ffmpeg_format_name(format: spa::param::video::VideoFormat) -> &'static str {
    use spa::param::video::VideoFormat;
    match format {
        VideoFormat::BGRA => "bgra",
        VideoFormat::BGRx => "bgr0",
        VideoFormat::RGBA => "rgba",
        VideoFormat::RGBx => "rgb0",
        _ => "bgra",
    }
}

/// Runs the capture loop until the app says stop. Blocking: the caller owns the
/// thread.
#[allow(clippy::too_many_arguments)]
pub fn run(
    stream: OwnedFd,
    node_id: u32,
    video_fd: RawFd,
    cursor: Arc<Mutex<CursorState>>,
    clicks: Receiver<(String, bool)>,
    control: Receiver<Control>,
    paused: Arc<AtomicBool>,
    cursor_is_metadata: bool,
    clicks_available: bool,
) -> Result<()> {
    let mainloop =
        pw::main_loop::MainLoop::new(None).context("could not create a PipeWire loop")?;
    let context =
        pw::context::Context::new(&mainloop).context("could not create a PipeWire context")?;
    let core = context
        .connect_fd(stream, None)
        .context("could not connect to the portal's PipeWire remote")?;

    let stats = Arc::new(CaptureStats {
        frames: AtomicU64::new(0),
        dropped: AtomicU64::new(0),
    });

    let stream_props = pw::properties::properties! {
        *pw::keys::MEDIA_TYPE => "Video",
        *pw::keys::MEDIA_CATEGORY => "Capture",
        *pw::keys::MEDIA_ROLE => "Screen",
    };
    let pw_stream = pw::stream::Stream::new(&core, "demothat-cursor-helper", stream_props)
        .context("could not create the capture stream")?;

    let stop = Arc::new(AtomicBool::new(false));

    let user_data = UserData {
        events: Emitter::new(std::io::stdout()),
        video_fd,
        stats: stats.clone(),
        cursor,
        clicks,
        started: false,
        frames_without_cursor: 0,
        format_name: String::new(),
        width: 0,
        height: 0,
        paused: paused.clone(),
        stop: stop.clone(),
        main_loop: mainloop.clone(),
        cursor_is_metadata,
        clicks_available,
    };

    let listener = pw_stream
        .add_local_listener_with_user_data(user_data)
        .param_changed(|_, data, id, param| {
            if id != spa::param::ParamType::Format.as_raw() {
                return;
            }
            let Some(param) = param else { return };
            let mut info = spa::param::video::VideoInfoRaw::default();
            if info.parse(param).is_err() {
                return;
            }
            data.width = info.size().width;
            data.height = info.size().height;
            data.format_name = ffmpeg_format_name(info.format()).to_string();

            // The app cannot start FFmpeg without the frame geometry: this event is
            // how it learns what it is about to receive, and it is emitted before
            // the first frame is written.
            if !data.started && data.width > 0 && data.height > 0 {
                data.started = true;
                data.events.emit(Event::Started {
                    width: data.width,
                    height: data.height,
                    format: data.format_name.clone(),
                    cursor_mode: if data.cursor_is_metadata {
                        "metadata"
                    } else {
                        "embedded"
                    }
                    .into(),
                    clicks: data.clicks_available,
                    pid: std::process::id(),
                });
            }
        })
        .process(|stream, data| {
            // Stopping happens here, inside the loop, because the loop cannot be
            // stopped from another thread safely. A recording always has frames
            // flowing, so this is reached promptly; if the compositor ever stalls,
            // the app kills the helper instead (see the app's client).
            if data.stop.load(Ordering::Relaxed) {
                data.main_loop.quit();
                return;
            }

            // Raw bindings rather than `Stream::dequeue_buffer`: the safe Buffer
            // does not expose metas, and the pointer's position lives in one.
            let raw = unsafe { pw_sys::pw_stream_dequeue_buffer(stream.as_raw_ptr()) };
            if raw.is_null() {
                data.stats.dropped.fetch_add(1, Ordering::Relaxed);
                return;
            }

            let spa_buffer = unsafe { (*raw).buffer };
            if let Some((x, y)) = unsafe { read_cursor_meta(spa_buffer) } {
                let mut cursor = data.cursor.lock().unwrap();
                cursor.x = x;
                cursor.y = y;
                cursor.have_position = true;
            } else {
                data.frames_without_cursor += 1;
                // A compositor that promised cursor metadata and never sends any is
                // worth mentioning once, not once per frame.
                if data.cursor_is_metadata && data.frames_without_cursor == 60 {
                    data.events.emit(Event::Warning {
                        message:
                            "no cursor metadata from the compositor; cursor effects will be empty"
                                .into(),
                    });
                }
            }

            write_frame(data, spa_buffer);
            data.stats.frames.fetch_add(1, Ordering::Relaxed);
            data.emit_cursor_and_clicks();

            // Hand the buffer back: the compositor reuses these.
            unsafe { pw_sys::pw_stream_queue_buffer(stream.as_raw_ptr(), raw) };
        })
        .register()
        .context("could not register the capture callbacks")?;

    // Only raw video, in one format (BGRA, which every compositor can produce), and
    // only CPU-readable buffers.
    let mut format_buffer = vec![0u8; 1024];
    let mut buffers_buffer = vec![0u8; 1024];
    let mut pods: Vec<&Pod> = Vec::new();

    let format_object = Object {
        type_: spa::sys::SPA_TYPE_OBJECT_Format,
        id: spa::param::ParamType::EnumFormat.as_raw(),
        properties: vec![
            Property::new(
                spa::sys::SPA_FORMAT_mediaType,
                Value::Id(Id(spa::sys::SPA_MEDIA_TYPE_video)),
            ),
            Property::new(
                spa::sys::SPA_FORMAT_mediaSubtype,
                Value::Id(Id(spa::sys::SPA_MEDIA_SUBTYPE_raw)),
            ),
            Property::new(
                spa::sys::SPA_FORMAT_VIDEO_format,
                Value::Id(Id(spa::param::video::VideoFormat::BGRA.as_raw())),
            ),
        ],
    };
    let (_, format_len) = PodSerializer::serialize(
        std::io::Cursor::new(&mut format_buffer),
        &Value::Object(format_object),
    )
    .context("could not build the format parameter")?;
    let format_pod = Pod::from_bytes(&format_buffer[..format_len as usize])
        .context("could not parse the format parameter we just built")?;
    pods.push(format_pod);

    // Ask for shared-memory buffers. `dataType` is a flag set, so a compositor that
    // can only do DMA-BUF says so instead of quietly sending memory we cannot read.
    let mem_flags: i32 =
        ((1 << spa::sys::SPA_DATA_MemFd) | (1 << spa::sys::SPA_DATA_MemPtr)) as i32;
    let buffers_object = Object {
        type_: spa::sys::SPA_TYPE_OBJECT_ParamBuffers,
        id: spa::param::ParamType::Buffers.as_raw(),
        properties: vec![Property::new(
            spa::sys::SPA_PARAM_BUFFERS_dataType,
            Value::Int(mem_flags),
        )],
    };
    let (_, buffers_len) = PodSerializer::serialize(
        std::io::Cursor::new(&mut buffers_buffer),
        &Value::Object(buffers_object),
    )
    .context("could not build the buffer parameter")?;
    let buffers_pod = Pod::from_bytes(&buffers_buffer[..buffers_len as usize])
        .context("could not parse the buffer parameter we just built")?;
    pods.push(buffers_pod);

    pw_stream
        .connect(
            spa::utils::Direction::Input,
            Some(node_id),
            pw::stream::StreamFlags::AUTOCONNECT | pw::stream::StreamFlags::MAP_BUFFERS,
            &mut pods,
        )
        .context("could not connect to the portal's screen stream")?;

    // Control arrives from stdin (the app writes it) on its own thread and only
    // raises flags; the capture loop acts on them.
    {
        let paused = paused.clone();
        let stop = stop.clone();
        std::thread::spawn(move || {
            for control in control.recv().into_iter() {
                match control {
                    Control::Pause => paused.store(true, Ordering::Relaxed),
                    Control::Resume => paused.store(false, Ordering::Relaxed),
                    Control::Stop => {
                        stop.store(true, Ordering::Relaxed);
                        break;
                    }
                }
            }
        });
    }

    mainloop.run();
    drop(listener);

    let mut events = Emitter::new(std::io::stdout());
    events.emit(Event::Ended {
        frames: stats.frames.load(Ordering::Relaxed),
        dropped: stats.dropped.load(Ordering::Relaxed),
    });

    Ok(())
}

/// Copies one frame out of a `spa_buffer` into the video pipe, row by row when the
/// compositor pads its rows.
fn write_frame(data: &mut UserData, buffer: *mut spa::sys::spa_buffer) {
    unsafe {
        if buffer.is_null() || (*buffer).n_datas == 0 || (*buffer).datas.is_null() {
            data.stats.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let spadata = (*buffer).datas;
        if (*spadata).data.is_null() {
            // No mapping: the buffer is in GPU memory, which we do not ask for.
            data.stats.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let row_bytes = (data.width as usize) * 4;
        if row_bytes == 0 {
            data.stats.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }

        let chunk = (*spadata).chunk;
        let (offset, size, stride) = if chunk.is_null() {
            (0usize, row_bytes * data.height as usize, row_bytes as i32)
        } else {
            (
                (*chunk).offset as usize,
                (*chunk).size as usize,
                if (*chunk).stride == 0 {
                    row_bytes as i32
                } else {
                    (*chunk).stride
                },
            )
        };
        let base = (*spadata).data as *const u8;

        if stride as usize == row_bytes {
            if size > 0 {
                write_all_fd(
                    data.video_fd,
                    std::slice::from_raw_parts(base.add(offset), size),
                );
            }
            return;
        }
        if stride < 0 {
            // Bottom-up frames would come out scrambled, so drop rather than guess.
            data.stats.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        for row in 0..data.height as usize {
            let start = base.add(offset + row * stride as usize);
            write_all_fd(data.video_fd, std::slice::from_raw_parts(start, row_bytes));
        }
    }
}

/// Writes a frame to the pipe. A short write means the app closed its end; the
/// frame is dropped rather than treated as fatal, because a recording that is being
/// stopped should not turn into an error.
fn write_all_fd(fd: RawFd, bytes: &[u8]) {
    let mut written = 0usize;
    while written < bytes.len() {
        let borrowed = unsafe { BorrowedFd::borrow_raw(fd) };
        match nix_write(borrowed.as_raw_fd(), &bytes[written..]) {
            Ok(0) => return,
            Ok(count) => written += count,
            Err(_) => return,
        }
    }
}

fn nix_write(fd: RawFd, bytes: &[u8]) -> std::io::Result<usize> {
    let written = unsafe { libc::write(fd, bytes.as_ptr() as *const libc::c_void, bytes.len()) };
    if written < 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(written as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cursor_abi_matches_the_header_it_was_copied_from() {
        // Sizes from spa/meta/meta.h: id, flags, position(2 x i32),
        // hotspot(2 x i32), bitmap_offset, padded to the struct's alignment.
        assert_eq!(std::mem::size_of::<SpaMetaCursor>(), 28);
        assert_eq!(std::mem::size_of::<SpaMeta>(), 16);
        assert_eq!(std::mem::align_of::<SpaMetaCursor>(), 4);
    }

    #[test]
    fn cursor_meta_type_is_the_fifth_enum_entry() {
        // SPA_META_Invalid, Header, VideoCrop, VideoDamage, Bitmap, Cursor
        assert_eq!(SPA_META_CURSOR, 5);
    }

    #[test]
    fn formats_map_to_ffmpeg_names() {
        use spa::param::video::VideoFormat;
        assert_eq!(ffmpeg_format_name(VideoFormat::BGRA), "bgra");
        assert_eq!(ffmpeg_format_name(VideoFormat::BGRx), "bgr0");
        assert_eq!(ffmpeg_format_name(VideoFormat::RGBA), "rgba");
        assert_eq!(ffmpeg_format_name(VideoFormat::RGBx), "rgb0");
    }

    #[test]
    fn a_null_buffer_has_no_cursor() {
        assert!(unsafe { read_cursor_meta(std::ptr::null_mut()) }.is_none());
    }
}
