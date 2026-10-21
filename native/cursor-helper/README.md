# demothat-cursor-helper

A small native helper that does the two things Electron cannot do on Wayland:
own the screen-cast session, and read the pointer's position out of it.

Without it, DemoThat records on Wayland through Chromium's own screen share, which
asks the compositor to _embed_ the cursor in the frames. The recording looks right,
but the pointer is part of the pixels, so the editor cannot restyle it, animate it,
or follow it. This helper asks for the same screen with `cursor_mode = METADATA`
instead, keeps the pointer out of the frames, and reports where it went.

## What it does

```
usage: demothat-cursor-helper '{"videoFd":3,"fps":30,"clickIdleTimeoutMs":2000}'

stdout  NDJSON events, one per line:
          {"type":"started","width":2560,"height":1440,"format":"bgra",
           "cursor_mode":"metadata","clicks":true,"pid":1234}
          {"type":"move","timestamp":1700000000000,"x":812.5,"y":430}
          {"type":"click","timestamp":1700000000001,"x":812.5,"y":430,
           "button":"left","pressed":true}
          {"type":"warning","message":"…"}      // does not stop the capture
          {"type":"ended","frames":900,"dropped":0}
          {"type":"error","message":"…"}        // fatal; app falls back
fd 3    raw video frames, row-padded as the compositor sends them
stdin   pause / resume / stop (EOF also stops)
exit    0 finished, 2 nothing captured, 64 bad usage
```

`started` is the important one: the app cannot build its FFmpeg command line until
it knows the frame size and pixel format, which is why the geometry is announced
before the first frame is written.

Deliberate choices, each of which trades something:

- **Shared memory only.** Buffers are requested as `MemFd`/`MemPtr`, never
  DMA-BUF, so the frames are readable without a GPU or an EGL/GBM stack. The cost
  is a copy inside the compositor.
- **No encoder.** Raw frames leave on a descriptor and the app pipes them into the
  FFmpeg it already bundles.
- **Reads `/dev/input` only for the left button**, only on pointer devices, never
  on keyboards. Without read permission it reports a warning and records anyway.

## Requirements

- `xdg-desktop-portal` with a ScreenCast backend (GNOME, KDE, or
  `xdg-desktop-portal-wlr` for wlroots compositors) and PipeWire.
- Build: `libpipewire-0.3-dev`, `libclang-dev`, `pkg-config`, cargo.
- For click capture, read access to pointer devices — see the udev rule in
  `docs/wayland-native-cursor-plan.md`.

## Building and trying it by hand

```bash
cd native/cursor-helper
cargo build --release
cargo test
```

On a Wayland desktop:

```bash
./target/release/demothat-cursor-helper '{"videoFd":3}' 3>/tmp/screen.bgra | tee /tmp/events.ndjson
```

The compositor asks which screen to share. Then read the announced size from the
`started` event and encode what was captured:

```bash
ffmpeg -f rawvideo -pix_fmt bgra -s 2560x1440 -r 30 -i /tmp/screen.bgra \
       -c:v libx264 -preset ultrafast /tmp/screen.mp4
```

Move the mouse, then stop the helper (`Ctrl+C`, or write `stop` to its stdin) and
check `/tmp/events.ndjson` for `move` and `click` lines. On GNOME or KDE you should
see `"cursor_mode":"metadata"` and a stream of positions. On Sway (and anything
else backed by `xdg-desktop-portal-wlr`, which rejects cursor mode 4) the helper
retries with the embedded cursor, reports `"cursor_mode":"embedded"` plus a warning,
and the pointer is in the video instead.

## Status

- Built and tested: 19 unit tests (protocol framing, the SPA cursor ABI, the frame
  rate reported to FFmpeg, evdev device classification, the cursor-mode retry
  decision), plus a clean `cargo build --release`.
- Exercised against a real portal in a headless session: negotiation runs, the
  metadata rejection is detected and retried with the embedded cursor, and failures
  are reported as one NDJSON `error` line with exit code 2 rather than a crash.
- **Wired into the app.** The recorder starts it on Wayland and pipes fd 3 into its
  bundled FFmpeg; if it cannot deliver, the app falls back to the browser capture
  path by itself. It ships as an `extraResources` entry, so a Linux release is still
  a single AppImage — build it with `npm run build:helper` before packaging.
- **Not yet verified on a real desktop** (that needs a GPU-backed compositor), and
  the cursor *bitmap* is not extracted, so the editor draws its own cursor rather
  than the desktop's.
