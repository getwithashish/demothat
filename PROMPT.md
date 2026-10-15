## 1. Goal

Implement, in this order:

1. **Phase 1:** Save and open projects as `.dthat` files.
2. **Phase 2:** Fix the export pipeline (backpressure, unused Quality setting, duplicated resolution constants).
3. **Phase 3:** Add an 8K export option.
4. **Phase 4:** Detect when an export is an upscale, gate it as a Pro feature, and show estimated render time.
5. **Phase 5:** Cloud upscaling. The video is rendered locally, then uploaded, upscaled on a GPU server, and downloaded.

Cloud rendering of the project itself is explicitly out of scope. The renderer is a seek-driven Chromium canvas loop, so a cloud GPU would not speed it up. Only the AI upscale and the HEVC encode benefit from cloud GPUs.

## 2. Ground rules

- The repo is a fork of ScreenArc: Electron 31, Vite, React 18, TypeScript, Zustand (with immer and zundo), electron-store, electron-log, vitest. Licensed GPL-3.0. Keep existing copyright headers.
- **Commits must follow Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`). Releases are fully automated from them via semantic-release, so a wrong prefix cuts a wrong release. Use `feat:` only for user-visible features and `fix:` for bug fixes.
- Before finishing each phase, run `npx tsc --noEmit`, `npm run lint`, `npm run format:check` and `npm test`. All must pass. Add vitest tests for pure logic. Existing main-process tests live next to the code (for example `electron/main/features/build-mux-args.test.ts`) and use the stubs in `electron/test/stubs/`.
- Do not commit binaries, API keys, or secrets. Do not edit `demothat-rebrand.patch` or `ui-revamp.patch`.
- The app ships on Windows, macOS (universal) and Linux (X11 only). Do not break any platform. Main-process code must not import renderer code.
- Follow the existing UI patterns and components in `src/components/ui/` and the token-based styling (there are style guardrail tests in `src/styles/`).
- If something you need is ambiguous, pick the simplest option that fits the codebase, state the assumption in the commit message or phase summary, and continue.

## 3. Verified facts about the codebase

These were read from the source. Re-check them quickly before relying on them.

**Export pipeline**

- `electron/main/features/export-manager.ts` (`startExport`) opens a hidden offscreen `BrowserWindow` that loads the renderer page (`src/pages/RendererPage.tsx`, route `#renderer`). It spawns FFmpeg reading raw `rgba` frames from stdin.
- `RendererPage.tsx` loops over frames. For each frame it seeks the `<video>` elements, calls `drawScene` (in `src/lib/renderer.ts`) onto a 2D canvas, calls `ctx.getImageData`, and sends the buffer with `window.electronAPI.sendFrameToMain({ frame, progress })`.
- The main process listens on `export:frame-data` and calls `ffmpeg.stdin.write(frame)` with **no backpressure**. The renderer never waits. A 4K RGBA frame is about 33 MB and an 8K frame about 132 MB, so a slow encoder makes frames pile up in memory.
- MP4 output is hardcoded `libx264 -preset medium -pix_fmt yuv420p` (plus AAC when audio exists). GIF uses palettegen/paletteuse.
- `ExportSettings` has `quality: 'low' | 'medium' | 'high'`, and the modal exposes it, but `export-manager.ts` never reads it. **It is a no-op.**
- Resolutions are defined in three places: `ResolutionKey` and `RESOLUTIONS` in `electron/main/lib/constants.ts`, `RESOLUTIONS` in `src/lib/constants.ts`, and the `resolution` union type in `src/components/editor/ExportModal.tsx`. `calculateExportDimensions` in `electron/main/lib/utils.ts` derives width from the height and the project aspect ratio.
- The modal's 'Estimated duration' is the output clip length (cuts and speed regions applied), not render time.
- The editor sends `plainState` to the export (see `src/hooks/useExportProcess.ts`). That object is already a clean, serializable subset of the editor state.
- `getFFmpegPath()` in `electron/main/lib/utils.ts` resolves a bundled binary under `binaries/<platform>/`. The binaries are not in git (the README says to download them from `tamnguyenvan/screenarc-assets`). **Unverified:** whether that build includes `libx265` or any hardware HEVC encoder.

**Projects and persistence**

- There is **no project save or load**. An editor session is created by `loadProject({ videoPath, metadataPath, webcamVideoPath })` in `src/store/slices/projectSlice.ts`, which reads the metadata JSON and auto-generates zoom regions. Only presets are persisted.
- State contains absolute file paths: `videoPath`, `webcamVideoPath`, `audioClips[].filePath`, `videoClips[].filePath`, `mouseClickSoundPath`, and possibly a custom background image (`frameStyles.background.imageUrl`, which can be a `blob:` URL). Built-in wallpapers are relative app assets (`wallpapers/images/...`) and should stay as they are.
- The `media://` custom protocol (in `electron/main/index.ts`) serves absolute paths to the renderer.
- `electron/main/index.ts` has **no** `open-file` handler, no `second-instance` handler and no single-instance lock.
- Config files: `package.json` has the real `build` config (appId `com.demothat.app`). `electron-builder.json5` is an unedited template (`appId: 'YourAppID'`). Put `fileAssociations` in `package.json` and confirm with a test build which config electron-builder actually reads.

## 4. Things to verify first (Phase 0)

Do these before writing code, and note the results in your first summary.

1. Install and run: `rm package-lock.json` (as the README says), `npm install`, download the FFmpeg binary for your OS into `binaries/`, and run `npm run dev` or at least the checks in section 2. Record the baseline test, lint and type-check results.
2. Run `ffmpeg -hide_banner -encoders | grep -E "265|hevc"` on the bundled binary. Report which HEVC encoders exist. If none, say so, because Phases 3 and 5 depend on it.
3. Read all of `loadProject` in `projectSlice.ts` and `EditorPage.tsx` to learn exactly what it sets, what it regenerates (auto zoom regions), and where `cursorTheme`, `cursorImages` and `platform` come from. Phase 1 depends on this.
4. Read `src/lib/renderer.ts` around where `frameContentWidth` and `frameContentHeight` are computed (roughly lines 436 to 470) and how padding and zoom scale are applied. Phase 4 reuses this math.

## 5. Phase 1: `.dthat` save and open

### 5.1 File format

A `.dthat` file is a zip archive:

```
project.dthat
  manifest.json    { format: 1, appVersion, createdAt, platform, source: { width, height, fps, durationSec } }
  project.json     the serializable editor state with all media paths made relative
  media/           screen video, webcam video, metadata JSON, audio clips, imported video clips,
                   custom click sound, custom background image
  thumbnail.jpg    optional
```

- Use a small pure-JS zip library in the main process (for example `fflate`, or `yazl` plus `yauzl`). Add it as a dependency. Do not shell out to system `zip`.
- Store media files without extra compression where they are already compressed (mp4, webm, mp3, jpg).
- `project.json` is the same field set as `plainState` in `useExportProcess.ts`, plus `metadataPath` content (copy the metadata JSON into `media/`). Drop fields that are re-derived on open.
- Cursor data (`cursorImages`, `cursorTheme`) can be very large when serialized, because RGBA arrays are stored as plain objects. After step 0.3, decide whether it is re-derived on open. If it must be stored, store it compactly (for example as binary files in `media/`) rather than inline JSON.
- Include `manifest.format`. Write a `migrateProject(json, fromFormat)` function with an identity migration for format 1, so future changes have a place to go.

### 5.2 Main-process module

Create `electron/main/features/project-file.ts` with at least:

- `saveProject(state, destPath)`: collects every referenced media file, copies it into the archive under `media/`, rewrites paths to archive-relative paths in `project.json`, writes the zip atomically (write to a temp file, then rename).
- `openProject(srcPath)`: validates, extracts into a per-project directory under `app.getPath('userData')/projects/<id>/`, rewrites relative paths back to absolute extracted paths, and returns the state.
- Pure helpers for path remapping, so they can be unit tested without Electron.

**Security (treat every `.dthat` as untrusted input):** reject zip entries with `..` or absolute paths (zip-slip), cap total uncompressed size and entry count, reject unknown top-level files, validate `manifest.json` and `project.json` shape before use, and refuse a `format` newer than this app supports with a clear message.

### 5.3 IPC and renderer

- Add IPC handlers (new file under `electron/main/ipc/handlers/`, registered in `electron/main/ipc/index.ts`) for `project:save`, `project:save-as` and `project:open`. Expose them in `electron/preload.ts` and the typings in `electron/electron-env.d.ts`.
- Add a store action that applies an opened project: call the existing `loadProject` with the extracted video, metadata and webcam paths, then **apply the saved edits on top**, so saved zoom regions, frame styles, cuts, speeds, audio clips and so on win. Make sure `loadProject` does not overwrite them with auto-generated zoom regions on this path.
- After applying, clear the zundo history so Undo does not step back into the empty or default project.
- Track a `currentProjectPath` and a dirty flag (set when state changes after the last save). Show the project name and an unsaved marker in the editor title area.

### 5.4 Menus, shortcuts, file association

- Add **Save Project**, **Save Project As...** and **Open Project...** to the app menu (`electron/main/features/app-menu.ts`), with `Ctrl/Cmd+S` for save (also wire it in `src/hooks/useKeyboardShortcuts.ts`). Add Open Project to the recorder window and the macOS dock menu next to 'Import Video File...'.
- In `electron/main/index.ts` add `app.requestSingleInstanceLock()`. Handle `open-file` (macOS), `process.argv` at startup (Windows and Linux) and `second-instance` (Windows and Linux) by opening the `.dthat` path. Queue any open request that arrives before the app is ready.
- If an editor session is already open with unsaved changes, ask before replacing it. If a recording is in progress, refuse with the same style of dialog used elsewhere in `index.ts`.
- Add `fileAssociations` to the `build` section of `package.json` (ext `dthat`, name 'DemoThat Project', role Editor), with a suitable icon if one can be generated from the existing icons. Do not add icons that need new binary assets without saying so.

### 5.5 Tests and acceptance

- Unit tests: save then open round-trip equals the original state (after path remapping), zip-slip entries are rejected, oversized archives are rejected, a too-new `format` is rejected, and a missing media file produces a clear error.
- Manual: record or import a video, add custom zooms and edits, save, quit, double-click the `.dthat`, and confirm the edits are restored and export still works. Report which of these you could actually run.

## 6. Phase 2: export pipeline fixes

1. **Backpressure.** Change the frame transport so the renderer waits until the main process has written the frame. Use `ipcRenderer.invoke` for frames (and `ipcMain.handle` in the export manager) that resolves after `ffmpeg.stdin.write` completes, waiting for `drain` when `write` returns false. Keep `progress` in the payload. Make cancellation and errors resolve the pending promise so the renderer loop never hangs. Also handle FFmpeg exiting early (stdin errors) without leaving the render worker running.
2. **Quality setting.** Map `quality` to encoder settings (for H.264: low about CRF 28, medium about CRF 23, high about CRF 18, with a slower preset for high). Put the mapping in a pure function with tests, for example next to `build-mux-args.ts`. Unit test the resulting args.
3. **Single source of truth for resolutions.** Define the resolution keys and sizes once, in a module both the main process and the renderer can import (check `tsconfig.json`, `tsconfig.node.json` and the vite-plugin-electron config to pick a location that both bundles can resolve). Remove the three duplicates. The modal's select options should be generated from that list.
4. **Extract an `buildExportArgs` function** from `startExport` (video codec, filters, audio mapping) so Phase 3 can unit test it. Keep behavior identical for existing settings.

Acceptance: a 1080p and a 4K export produce valid files with the same look as before, memory stays flat during a long 4K export, and Cancel stops everything promptly.

## 7. Phase 3: 8K export

1. Add `'8k'` (7680x4320) to the shared resolution list. Width stays derived from height and aspect ratio via `calculateExportDimensions`, so non-16:9 aspect ratios still work.
2. **Render cap.** Do not allocate an 8K canvas. Introduce a render cap (default 3840 on the longest side or 2160 on height, adjustable in one constant). The renderer draws at `min(target, cap)`, and FFmpeg scales to the exact target size with `-vf scale=W:H:flags=lanczos` before encoding. Keep the raw input size (`-s`) equal to the render size, not the target size. Make sure the audio `-filter_complex` and the video `-vf` coexist correctly with `-map 0:v:0` and `-map [aout]`, and cover this with args tests.
3. **Codec.** For targets above 4K use HEVC: `libx265` (or a hardware encoder if you detect one and it is clearly better), `-tag:v hvc1`, `-pix_fmt yuv420p`. Keep H.264 for 4K and below. If the bundled FFmpeg has no HEVC encoder (see Phase 0), do not silently fall back to H.264 at 8K. Disable the 8K option with a tooltip explaining why, and document in your summary what binary change is needed.
4. **GIF** is disabled above 2K.
5. Make progress and ETA stay correct, since the FFmpeg stage is now slower than rendering. Consider reporting FFmpeg's own progress (`-progress pipe:1`) rather than only frames sent.

Acceptance: 8K MP4 export of a short clip plays in VLC and in a browser that supports HEVC, dimensions are exactly 7680x4320, and peak memory stays reasonable.

## 8. Phase 4: upscale detection, Pro gating and time estimates

### 8.1 Detecting an upscale

Implement a pure function (in `src/lib/`, with tests) that answers: how many source pixels does the screen content have compared with how many output pixels it will fill?

- Inputs: `videoDimensions`, the frame padding and aspect ratio from `frameStyles`, the target output size, and the largest zoom level among `zoomRegions` (and camera-motion scale if present).
- Use the same content-size math as `renderer.ts` (padding applied to the output size, then the video fitted by aspect ratio), so the answer matches what is really drawn.
- `requiredScale = (contentWidthAtTarget * maxZoom) / videoDimensions.width`. Treat the export as an upscale when `requiredScale > 1.05` (small tolerance so nobody is nagged for rounding).
- Do not simply compare output height to video height. Padding makes a 1080p source at 1080p output a slight downscale.

### 8.2 Entitlement (Pro)

Create `electron/main/features/entitlement.ts` exposing `getEntitlement(): Promise<{ pro: boolean; credits: number }>`. For now back it with a stub that reads a license key from `electron-store` and a placeholder verification function, clearly marked TODO, with an environment variable to force Pro on in development. Do not invent a real payment backend here.

**Be honest in code comments and the summary:** this app is GPL-3.0, so a local check can be removed by anyone who rebuilds it. The local gate is a soft convenience. Only the cloud path (Phase 5) can enforce payment, because the server checks credits.

### 8.3 Export modal changes

- Mark each resolution that would be an upscale with a **Pro** badge, computed live from the current project and the Phase 4.1 function.
- If the user is not entitled, selecting a Pro resolution shows an inline explanation and an action to unlock (placeholder that opens a configurable URL). Starting the export is blocked for Pro resolutions without entitlement.
- Offer two upscale methods when an upscale is needed: **Standard** (FFmpeg Lanczos, local) and **AI (cloud)** (Phase 5). The AI option is hidden or disabled until the cloud client is configured.

### 8.4 Estimated render time

The existing 'Estimated duration' row is the clip length. Keep it, and add an 'Estimated render time' row for each available method.

- Frames: `outputSeconds * fps`.
- Local: `frames / localFps`, where `localFps` is the measured throughput. Save the measured frames per second after every completed export in `electron-store`, keyed by resolution, codec and fps. Before any measurement exists, show a wide range labeled as rough. Add a small pure function with tests: it scales a measured fps from one resolution to another by output-pixel ratio.
- Live ETA during export: from the progress events (`elapsed / progress`), shown in the progress view.
- Cloud (when configured): `upload + startup + upscaleCompute + download`, with `upload = fileMB * 8 / uplinkMbps`, `startup` and `upscaleCompute` taken from the server's `capabilities` response, and `download` estimated from the expected output size. Show the breakdown, because upload often dominates on slow connections and can make cloud slower than local for short clips. Highlight whichever option is faster.
- Do not hardcode GPU benchmark numbers in the client.

Acceptance: the Pro badges match reality on at least these cases: a 1080p recording at 1080p output with default padding, the same recording at 4K and 8K, and a 4K recording at 4K.

## 9. Phase 5: cloud upscaling (render locally, upscale in the cloud)

### 9.1 Flow

1. Render locally exactly as today, but to an intermediate file at the render cap size (or the target size if smaller). Use a high-quality intermediate (for example H.264 at CRF 12 to 16, or another near-lossless setting the bundled FFmpeg supports) with the final audio already muxed, so the server only has to upscale video and copy audio.
2. Upload the intermediate to the backend.
3. The server upscales with Video2X (Real-ESRGAN), scales to the exact target size, encodes HEVC, and stores the result.
4. The client polls for progress, downloads the result to the user's chosen output path, and deletes the intermediate.

The `.dthat` file is not part of this flow. The server never sees the project, only the rendered video.

### 9.2 Server job (spec only, not built in this repo)

Write `docs/cloud-upscale-api.md` describing the contract, and implement the client against it plus a small mock server (a script under `scripts/` is fine) so the client can be developed and tested without the real backend.

- `GET /v1/capabilities`: returns available models, supported targets, benchmarked `upscaleFps` per target size, `startupSeconds`, and limits.
- `POST /v1/jobs`: body `{ sourceWidth, sourceHeight, fps, durationSec, fileSizeBytes, targetWidth, targetHeight, model }`. Returns `{ jobId, uploadUrl, creditsReserved }` or an error such as insufficient credits.
- `GET /v1/jobs/:id`: returns `{ status, progress, etaSeconds, downloadUrl? }`.
- `DELETE /v1/jobs/:id`: cancel and release credits.
- The server must `ffprobe` the uploaded file itself and compute the price from the real dimensions. It must never trust client-reported numbers. Credits are reserved at job creation and settled only on success.
- Worker environment (reference: the Video2X Colab notebook the owner shared): Video2X 6.2.0 Linux package, Vulkan libraries, an NVIDIA driver, FFmpeg 7, `realesr-animevideov3` or `realesrgan-plus`, then HEVC via NVENC. The Colab notebook itself is a reference only. It is interactive, tied to Google Drive and has session limits. Do not automate Colab.
- Retention: delete uploads and results after download or within 24 hours. Use TLS and short-lived presigned URLs.

### 9.3 Scale planning

Write a pure function with tests: given the uploaded video size and the target size, choose the model scale factor and the final FFmpeg scale.

- `need = max(targetW / srcW, targetH / srcH)`. `realesr-animevideov3` supports 2x, 3x and 4x. The other Real-ESRGAN models support only 4x.
- Pick the smallest supported scale that is at least `need`, then scale to the exact target with Lanczos. For example 1080p to 8K is exactly 4x, 1440p to 8K is 3x, and 720p to 8K is 4x followed by a downscale to 7680x4320.
- Screen recordings are mostly flat UI and text, so default to `realesr-animevideov3`, and let the server expose alternatives through `capabilities`.

### 9.4 Client implementation

- `electron/main/features/cloud-upscale-client.ts`: upload with progress (streaming, not loading the whole file into memory), polling with backoff, cancellation, and resumable error handling for network failures. Backend base URL and auth token come from settings (`electron-store`), not constants in code.
- First use shows a consent dialog saying the rendered video is uploaded, how long it is kept, and what it costs in credits. Remember the choice.
- Export modal states: Rendering locally, Uploading, Upscaling in the cloud, Downloading, Done, plus clear error and cancel states at each stage. Reuse the existing progress view and result view components.
- If the cloud step fails after local rendering succeeded, keep the intermediate file and offer to retry or to fall back to Standard (Lanczos) upscaling, so the user's render time is not wasted.
- The AI (cloud) option is gated by the entitlement and credits returned from the server, and the server is the enforcement point.

### 9.5 Notes about local AI upscaling

Do not bundle Video2X in the desktop app in this work. To the best of the owner's knowledge Video2X 6.x ships Windows and Linux builds but not macOS, it adds hundreds of MB, and it is AGPL-3.0 (verify before ever bundling it). If local AI upscaling is wanted later, treat it as a separate task with download-on-demand.

Acceptance: with the mock server, an export that is an upscale renders locally, uploads, shows progress through each stage, downloads, and produces a file at the exact target size. Cancel works at every stage. A mocked insufficient-credits response shows a clear message and does not start rendering.

## 10. Final checks and report format

At the end of every phase, reply with:

- What you changed (files and one line each).
- Test, lint, type-check and format results, and anything you could not run.
- Assumptions you made and open questions.
- Anything in this brief that turned out to be wrong, with the evidence.

Do not start the next phase until the owner confirms.
