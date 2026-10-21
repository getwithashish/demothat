// The helper's contract with the app: one JSON object per line on stdout, and
// three words on stdin.
//
// Same shape as the app's other subprocess boundary (see the FFmpeg and mux
// code): the child is told everything it needs up front on argv, reports
// continuously on stdout, and is stopped by a line on stdin or by EOF. Nothing
// here allocates or reads files, so the whole protocol is unit-testable.

use serde::Serialize;
use std::io::Write;

/// Milliseconds since the Unix epoch, the clock the app stamps its own events
/// with (`Date.now()`), so recorded samples line up with the recording without a
/// second synchronisation step.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// The stream is negotiated and the first frame is on its way. The app needs
    /// `width`/`height` before it can start FFmpeg on the raw frames, and `format`
    /// to tell FFmpeg what those bytes are.
    Started {
        width: u32,
        height: u32,
        format: String,
        cursor_mode: String,
        /// False when clicks are unavailable (no evdev permission); the app keeps
        /// recording, only click effects are missing.
        clicks: bool,
        pid: u32,
    },
    /// A cursor sample. `x`/`y` are in the captured stream's pixels, which is the
    /// same space the app records geometry in.
    Move { timestamp: u64, x: f64, y: f64 },
    Click {
        timestamp: u64,
        x: f64,
        y: f64,
        button: String,
        pressed: bool,
    },
    /// Something the user should know about but which does not stop the capture.
    Warning { message: String },
    /// The capture stopped, with what it managed to deliver.
    Ended { frames: u64, dropped: u64 },
    /// Fatal. The app treats this as "fall back to the browser capture path" and
    /// shows the message in the log.
    Error { message: String },
}

impl Event {
    pub fn to_line(&self) -> String {
        // Compact JSON never contains a newline, so a line is a message and a
        // message is a line. Serialisation of these types cannot fail.
        let mut line =
            serde_json::to_string(self).unwrap_or_else(|_| String::from(r#"{"type":"error"}"#));
        line.push('\n');
        line
    }
}

/// Writes events to stdout, one flushed line at a time: the app reads this
/// stream continuously and must never wait for a buffer to fill.
pub struct Emitter<W: Write> {
    out: W,
}

impl<W: Write> Emitter<W> {
    pub fn new(out: W) -> Self {
        Self { out }
    }

    pub fn emit(&mut self, event: Event) {
        // A broken pipe means the app is gone; there is nobody left to tell.
        let _ = self.out.write_all(event.to_line().as_bytes());
        let _ = self.out.flush();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Control {
    Pause,
    Resume,
    Stop,
}

/// Parses one control line. Unknown lines are ignored rather than fatal: the app
/// may write something we do not understand, and that is not a reason to end a
/// recording.
pub fn parse_control(line: &str) -> Option<Control> {
    match line.trim() {
        "pause" => Some(Control::Pause),
        "resume" => Some(Control::Resume),
        "stop" => Some(Control::Stop),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn events_serialise_to_single_lines() {
        let events = [
            Event::Started {
                width: 1920,
                height: 1080,
                format: "bgra".into(),
                cursor_mode: "metadata".into(),
                clicks: true,
                pid: 4242,
            },
            Event::Move {
                timestamp: 1_700_000_000_000,
                x: 10.5,
                y: 20.25,
            },
            Event::Click {
                timestamp: 1_700_000_000_001,
                x: 10.5,
                y: 20.25,
                button: "left".into(),
                pressed: true,
            },
            Event::Warning {
                message: "clicks unavailable".into(),
            },
            Event::Ended {
                frames: 300,
                dropped: 2,
            },
            Event::Error {
                message: "no screenshare".into(),
            },
        ];

        for event in events {
            let line = event.to_line();
            assert_eq!(line.matches('\n').count(), 1, "one line per event");
            assert!(line.ends_with('\n'));
            let parsed: serde_json::Value =
                serde_json::from_str(line.trim_end()).expect("valid json");
            assert!(parsed.get("type").is_some(), "every event is tagged");
        }
    }

    #[test]
    fn the_apps_expected_field_names_are_what_we_emit() {
        // The TypeScript side reads these names; renaming one here silently
        // dropping cursor samples is exactly the bug this test exists to catch.
        let move_line = Event::Move {
            timestamp: 7,
            x: 1.0,
            y: 2.0,
        }
        .to_line();
        let value: serde_json::Value = serde_json::from_str(move_line.trim_end()).unwrap();
        assert_eq!(value["type"], "move");
        assert_eq!(value["timestamp"], 7);
        assert_eq!(value["x"], 1.0);
        assert_eq!(value["y"], 2.0);

        let started = Event::Started {
            width: 640,
            height: 480,
            format: "bgra".into(),
            cursor_mode: "metadata".into(),
            clicks: false,
            pid: 1,
        }
        .to_line();
        let value: serde_json::Value = serde_json::from_str(started.trim_end()).unwrap();
        assert_eq!(value["width"], 640);
        assert_eq!(value["height"], 480);
        assert_eq!(value["format"], "bgra");
        assert_eq!(value["clicks"], false);
    }

    #[test]
    fn emitter_writes_one_flushed_line_per_event() {
        let mut buffer: Vec<u8> = Vec::new();
        {
            let mut emitter = Emitter::new(&mut buffer);
            emitter.emit(Event::Warning {
                message: "a".into(),
            });
            emitter.emit(Event::Warning {
                message: "b".into(),
            });
        }
        let text = String::from_utf8(buffer).unwrap();
        assert_eq!(text.lines().count(), 2);
    }

    #[test]
    fn control_lines_are_read_leniently() {
        assert_eq!(parse_control("stop\n"), Some(Control::Stop));
        assert_eq!(parse_control("  pause  "), Some(Control::Pause));
        assert_eq!(parse_control("resume"), Some(Control::Resume));
        assert_eq!(parse_control("what?"), None);
        assert_eq!(parse_control(""), None);
    }
}
