# Wayland cursor telemetry: the follow-up this change deliberately did not do

Status: implemented and wired in. `native/cursor-helper/` is built by
`npm run build:helper`, staged into `build/cursor-helper/`, shipped as an
`extraResources` entry in the same single AppImage, and started by the recorder on
Wayland (see `electron/main/features/cursor-helper.ts`). When it cannot deliver —
not bundled, portal without cursor metadata, missing permissions — the app falls
back to the browser capture path on its own, so every machine still records.

What remains: real-desktop verification (only a machine with a GPU-backed
compositor can prove capture end to end), and the cursor *shape/bitmap*: positions
and clicks come back, but the portal's cursor bitmap is not extracted yet, so the
editor draws its own cursor rather than the desktop's.

## What is missing, and why

On Wayland the recorder captures the screen through xdg-desktop-portal, and
Chromium paints the pointer **into** the video frames. There is no separate
stream of cursor positions or clicks, so for a Wayland recording:

- the editor draws no synthetic cursor (nothing to draw), and
- cursor styling, click ripple, click scale, cursor-zoom and the smoothing and
  motion-blur added in `src/lib/cursor-blur.ts` / `src/lib/cursor-path.ts` all
  have no input.

This is not an implementation gap we can close in JavaScript. Wayland
deliberately denies applications global pointer coordinates, and Electron follows
suit: `screen.getCursorScreenPoint()` is documented as unsupported on Wayland, and
it was verified here to be unusable in practice — which is why the recorder skips
the X11 mouse tracker entirely on Wayland instead of recording a frozen pointer
(`electron/main/features/recording-manager.ts`, the `requiresPortalCapture()`
branch).

## How the gap is closed (the shape of the work)

A screen-cast session can hand over the cursor as _data_ rather than as pixels.
The portal offers three cursor modes at `SelectSources` time; Chromium asks for
the embedded one, but a client that talks to the portal itself can ask for
`METADATA` and then receive positions on the PipeWire stream alongside the video.
That requires driving the portal and PipeWire directly, which means a small
native helper process, launched by the app:

1. **Sidecar binary** exposing a line-based protocol on stdio, matching how this
   codebase already treats the app↔FFmpeg boundary (spawn, JSON config in, NDJSON
   events out, `stop`/`pause` on stdin, EOF to finish). Reference implementation to
   read before writing anything: `getopenscreen/openscreen`'s
   `electron/native/pipewire-capture` (Rust, `ashpd` for the portal, its own
   PipeWire loop, screencopy fallback, `evdev` for clicks).
2. **Portal negotiation**, in this order: `CreateSession` → `SelectSources`
   (`cursor_mode = METADATA`, source types decided here — `SelectSources` can only
   be called once per session) → `Start` → `OpenPipeWireRemote`. Cursor mode must
   be `METADATA`, not `Embedded`, or the pointer is baked into the frames again.
3. **Cursor events out**: position (and shape, when the portal supplies it) as
   NDJSON, plus the video frames written to a file, so `screenWebmPath`'s role is
   taken by the helper's output and the existing mux path keeps working unchanged.
4. **Clicks**: Wayland exposes no portal for button events. The only practical
   source is the kernel's `evdev` (`/dev/input/event*`), which needs read access —
   either an `input` group membership or, better, a udev `uaccess` rule limited to
   pointer devices and explicitly excluding keyboards. This is why "use udev" is
   not a fix on its own: evdev yields button presses **and no coordinates**, so it
   is only useful once step 3 supplies positions to attach them to. A click with no
   position cannot drive the cursor overlay, the click ripple or auto-zoom. Without
   the rule (or with the keyboard-inclusive `input` group) every sample stays a
   plain move, and recording is unaffected either way.

   The rule (OpenScreen's approach, which is the reference implementation here):

   ```
   # /etc/udev/rules.d/70-demothat-mouse.rules — pointer devices only, never keyboards
   KERNEL=="event*", SUBSYSTEM=="input", ENV{ID_INPUT_MOUSE}=="1", ENV{ID_INPUT_KEYBOARD}!="1", TAG+="uaccess"
   KERNEL=="event*", SUBSYSTEM=="input", ENV{ID_INPUT_TOUCHPAD}=="1", ENV{ID_INPUT_KEYBOARD}!="1", TAG+="uaccess"
   ```

   Then `sudo udevadm control --reload-rules && sudo udevadm trigger
--subsystem-match=input` and check with `getfacl /dev/input/event*` (the user
   needs `user::rw-` on the pointer nodes). The helper must read _only_
   `BTN_LEFT`-class pointer events — never keystrokes — and the app should say so
   in the recorder UI, with an opt-out for anyone who does not want the reader at
   all.

5. **Wiring in the app**: the helper's cursor events feed the same
   `appState.recordedMouseEvents` / `runtimeCursorImageMap` path the X11 tracker
   feeds, so the editor needs no changes at all. `CaptureTraits.cursorTelemetry`
   (`src/lib/capture-backend.ts`) becomes true for Wayland and the recorder's
   "the pointer is recorded into the video" notice goes away.
6. **Packaging**: the helper is one more bundled resource, so the release stays a
   single AppImage (`extraResources` next to the bundled FFmpeg). It does mean a
   Rust toolchain in CI, and a build matrix decision: one static-ish binary per
   architecture, or ship none and fall back to today's behaviour.

## Honest trade-offs

- **Cost**: a new native subsystem, a new toolchain in the build, and a much
  larger surface to keep working across desktop environments. This is why it is a
  separate piece of work and not part of this change.
- **It depends on the desktop**: portal and compositor versions vary; GNOME and
  KDE both work, others may not. The fallback (today's behaviour) must stay the
  default on failure, not an error.
- **Permissions**: clicks need udev access the user may not have; a recording
  must still succeed without it.
- **Not everything comes back**: cursor _shape_ is not guaranteed on Wayland, so
  animated cursors may remain unavailable even after this.

## How it would be verified

- Unit level: the sidecar's protocol parsing and the event mapping.
- Real session: only on a machine with a **GPU-backed compositor**. Note for
  whoever picks this up: a GPU-less headless compositor cannot record through the
  portal at all — wlroots falls back to the pixman renderer, which cannot serve a
  screencopy buffer format the portal backend accepts ("unable to receive a valid
  format from wlr_screencopy"), so a CI box without `/dev/dri` proves nothing about
  capture. Use a real desktop or a GPU-passthrough VM.
- Acceptance: a Wayland recording whose editor shows an editable cursor, responds
  to click effects, and matches an X11 recording of the same action.
