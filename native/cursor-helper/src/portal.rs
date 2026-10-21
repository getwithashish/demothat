// The portal half: ask the desktop for a screen, and ask it for the pointer as
// data rather than as pixels.
//
// This is the reason the helper exists at all. Chromium's own screen share asks
// for the cursor to be *embedded*, so the pointer ends up burned into the video
// and nothing in JavaScript can know where it was. Opening our own ScreenCast
// session with CursorMode::Metadata keeps the pointer out of the frames and
// delivers its position alongside them, which is what the editor's cursor
// overlay, click effects and auto-zoom all need.
//
// Not every desktop implements that mode, though. xdg-desktop-portal-wlr (Sway
// and friends) rejects it with "Unavailable cursor mode 4", while GNOME's and
// KDE's backends support it. So the request is made optimistically and retried
// once with the embedded cursor, which turns "no cursor effects" into a working
// recording instead of a failed one.
//
// The compositor's own picker chooses the screen — Wayland does not let an
// application do that — so the app's display list is not used on this path.

use anyhow::{anyhow, Context, Result};
use ashpd::desktop::screencast::{CursorMode, Screencast, SourceType, Streams};
use ashpd::desktop::PersistMode;
use std::os::fd::OwnedFd;

pub struct CaptureStream {
    /// The PipeWire remote the portal handed us.
    pub fd: OwnedFd,
    /// Which node in that remote is our screen.
    pub node_id: u32,
    /// True when the compositor granted the metadata cursor mode, so the pointer is
    /// *not* in the pixels and the app draws it itself.
    pub cursor_is_metadata: bool,
    /// Something the app should pass on to the user when the desktop could not do
    /// what we asked for.
    pub notice: Option<String>,
}

/// True when the portal rejected our request because it does not implement the
/// cursor mode we asked for — mode 4 is Metadata.
///
/// Kept as a pure function so the retry decision is testable without a desktop:
/// this is the difference between a helper that works on Sway and one that does
/// not work anywhere except GNOME and KDE.
pub fn is_unsupported_cursor_mode(error: &str) -> bool {
    error.contains("Unavailable cursor mode")
        || error.contains("InvalidArgument")
        || error.to_lowercase().contains("cursor mode")
}

/// Opens a ScreenCast session: CreateSession -> SelectSources -> Start ->
/// OpenPipeWireRemote.
///
/// `SelectSources` may only be called once per session, so a rejected cursor mode
/// means starting a new session, and with it a second picker for the user. That is
/// why this retries exactly once and only for that specific rejection.
pub async fn open_capture_stream() -> Result<CaptureStream> {
    match open_session(CursorMode::Metadata).await {
        Ok(stream) => Ok(stream),
        Err(error) if is_unsupported_cursor_mode(&format!("{error:#}")) => {
            // The retry's own failure is reported as it comes: the caller wraps it in
            // context once, and a second copy of the same sentence helps nobody.
            let mut stream = open_session(CursorMode::Embedded).await?;
            stream.notice = Some(
                "this desktop cannot report the pointer separately, so the cursor is recorded into the video \
and cannot be restyled, moved or animated afterwards"
                    .to_string(),
            );
            Ok(stream)
        }
        Err(error) => Err(error),
    }
}

async fn open_session(cursor_mode: CursorMode) -> Result<CaptureStream> {
    let metadata = matches!(cursor_mode, CursorMode::Metadata);

    let proxy = Screencast::new()
        .await
        .context("no ScreenCast portal available")?;
    let session = proxy
        .create_session()
        .await
        .context("could not open a screencast session")?;

    proxy
        .select_sources(
            &session,
            cursor_mode,
            SourceType::Monitor.into(),
            false, // single stream: one monitor, which is what the app records
            None,  // no restore token: each recording asks afresh
            PersistMode::DoNot,
        )
        .await
        .context("the desktop refused the screen selection")?;

    let request = proxy
        .start(&session, None)
        .await
        .context("the desktop did not start the screencast")?;
    let streams = await_start_response(&request)?;
    let stream = streams
        .streams()
        .first()
        .ok_or_else(|| anyhow!("the desktop returned no screen streams"))?;
    let node_id = stream.pipe_wire_node_id();

    let fd = proxy
        .open_pipe_wire_remote(&session)
        .await
        .context("could not open the PipeWire remote")?;

    Ok(CaptureStream {
        fd,
        node_id,
        cursor_is_metadata: metadata,
        notice: None,
    })
}

/// Waits for the user to answer the portal's picker.
///
/// `Start` returns a handle immediately and the answer arrives later as a D-Bus
/// signal, which ashpd stores inside the request. Reading it before it lands panics
/// inside ashpd rather than returning an error, so the read is attempted in a loop
/// and a panic is treated as "not yet". The timeout is generous because it covers a
/// human choosing a screen.
fn await_start_response(request: &ashpd::desktop::Request<Streams>) -> Result<Streams> {
    use std::panic::{catch_unwind, AssertUnwindSafe};

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
    loop {
        match catch_unwind(AssertUnwindSafe(|| request.response())) {
            Ok(Ok(streams)) => return Ok(streams),
            Ok(Err(error)) => return Err(anyhow!("{error}")),
            Err(_) => {
                if std::time::Instant::now() > deadline {
                    return Err(anyhow!("the desktop never answered the screen picker"));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_the_rejection_xdg_desktop_portal_wlr_sends() {
        // Verbatim from xdg-desktop-portal-wlr 0.7.1 when asked for mode 4.
        let error = "the desktop refused the screen selection: Portal request failed: \
org.freedesktop.portal.Error.InvalidArgument: Unavailable cursor mode 4";
        assert!(is_unsupported_cursor_mode(error));
    }

    #[test]
    fn does_not_mistake_other_failures_for_a_cursor_mode_problem() {
        // A user cancelling the picker, or a missing portal, must not be retried:
        // that would show them a second dialog they did not ask for.
        assert!(!is_unsupported_cursor_mode(
            "the user cancelled the request"
        ));
        assert!(!is_unsupported_cursor_mode(
            "org.freedesktop.DBus.Error.ServiceUnknown"
        ));
        assert!(!is_unsupported_cursor_mode(
            "no ScreenCast portal available"
        ));
    }
}
