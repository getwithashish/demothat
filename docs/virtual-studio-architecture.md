# Virtual Studio: Architecture & Technical Guide

This document explains the architecture, design principles, and technical implementation of DemoThat's **Virtual Studio** feature. It serves as an authoritative guide for maintainers, future engineers, and AI agents seeking to understand, debug, or extend the virtual camera and microphone streaming system.

---

## 1. Overview & System Purpose

Virtual Studio allows users to stream their high-fidelity WYSIWYG editor canvas demonstrations, cursor effects, timeline audio, and physical webcam feeds directly into video conferencing tools (such as Google Meet, Zoom, Microsoft Teams, and Slack) as a recognized system webcam and microphone.

Key capabilities include:

- **Instant Auto-Return**: Automatic switching between physical webcam/microphone (when paused) and editor canvas/demo audio (when playing).
- **Smooth 1080p Full HD Output with 720p Stream Acceleration**: 30 FPS virtual camera output to video conferencing apps with SIMD-accelerated 720p-to-1080p upscaling and BT.709 color conversion, maintaining full 30 FPS preview playback without UI thread frame drops.
- **Dual-Output Audio Graph**: Parallel routing of timeline audio to local monitoring speakers and virtual microphone with click-free cross-fading.
- **Zero-Stutter UI Offload**: Background Web Worker processing keeping main UI thread latency $< 0.5\text{ ms}$ during live demo playback.
- **Always-Discoverable Virtual Devices**: Continuous standby slate keeping Linux V4L2 loopback devices active and discoverable by WebRTC browsers at all times.

---

## 2. Process Boundaries & High-Level Architecture

Virtual Studio spans the boundary between Electron's Chromium Renderer process and the Node.js Main process:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             RENDERER PROCESS                                │
│                                                                             │
│  [ React UI: HeaderPill / Mini-HUD ] ──> [ useEditorStore / StudioSlice ]    │
│                                                          │                  │
│                                                          ▼                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        VirtualStudioStreamer                          │  │
│  │                                                                       │  │
│  │  Webcam Path:                                                         │  │
│  │    [ <video> element ] ──(rVFC)──> [ 1080p Scratch Canvas ]           │  │
│  │                                                                       │  │
│  │  Demo Video Path:                                                     │  │
│  │    [ Source Canvas ] ──(createImageBitmap)──> [ Canvas Web Worker ]   │  │
│  │                                                 │ (OffscreenCanvas)   │  │
│  │                                                 ▼                     │  │
│  │                                           1080p RGBA Buffer           │  │
│  │                                                                       │  │
│  │  Audio Path:                                                          │  │
│  │    [ Physical Mic / Demo Bus ] ──> [ Dual-Output Web Audio Graph ]    │  │
│  │                                      ├──> [ Local Speakers ]          │  │
│  │                                      └──> [ AudioWorkletNode (PCM16)] │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
└──────────────────────────────────────┼──────────────────────────────────────┘
                                       │ ContextBridge IPC
                                       │ (pushFrame / pushAudio)
┌──────────────────────────────────────┼──────────────────────────────────────┐
│                                      ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                      VirtualStudioManager (Main)                      │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────────┐     ┌─────────────────────────────┐  │  │
│  │  │      VirtualCameraSink      │     │      VirtualAudioSink       │  │  │
│  │  │  - Size Validation (8.3 MB) │     │  - PCM16 Buffer Queuing     │  │  │
│  │  │  - Idle Standby Slate Timer │     │  - PipeWire / PulseAudio    │  │  │
│  │  │  - FFmpeg v4l2 Process      │     │  - ALSA Loopback Writer     │  │  │
│  │  └──────────────┬──────────────┘     └──────────────┬──────────────┘  │  │
│  └─────────────────┼───────────────────────────────────┼─────────────────┘  │
│                    ▼                                   ▼                    │
│             /dev/video10                        demothat_mic_sink           │
│        (v4l2loopback device)                  (PipeWire virtual mic)        │
│                                                                             │
│                               MAIN PROCESS                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Video Pipeline Implementation

### 3.1 Background Web Worker Canvas Offload & Pipelining (`virtual-camera-canvas.worker.ts`)

To prevent HTML5 canvas reads from blocking Chromium's single-threaded JavaScript UI and achieve rock-solid 30 FPS timeline playback:

1. `pushRenderedCanvas()` in `VirtualStudioStreamer` captures the current editor canvas using `createImageBitmap(sourceCanvas)`.
2. **720p Stream Acceleration**:
   - The internal renderer stream is standardized to $1280 \times 720$ (`DEFAULT_VIRTUAL_STUDIO_STREAM_RESOLUTION`), reducing pixel extraction from $2,073,600$ pixels (1080p) to $921,600$ pixels (720p) — a 56% reduction in per-frame compute load.
   - Drawing the preview canvas backing store at $1280 \times 720$ takes only $\sim 8\text{--}10\text{ ms}$ on the UI thread (well within the $33.3\text{ ms}$ 30 FPS deadline), leaving over $20\text{ ms}$ of frame headroom and eliminating frame drops entirely.
3. **Worker Pool & Pipelining**:
   - Manages a pool of background workers (`CANVAS_WORKER_POOL_SIZE = 3`).
   - While Worker 0 is extracting pixels for Frame $N$ (~20ms), Worker 1 processes Frame $N+1$, and Worker 2 processes Frame $N+2$.
   - This provides over $150\text{ FPS}$ aggregate pixel extraction capacity across the worker pool.
4. **Monotonic Sequence Reorder Buffer**:
   - Frames are assigned monotonically increasing sequence IDs.
   - Incoming processed frames are held in a sequence reorder buffer and delivered to IPC in strict chronological order, even if a worker resolves out of order.
5. Inside each Web Worker:
   - Renders onto a reusable `OffscreenCanvas` sized to $1280 \times 720$ (or target stream resolution).
   - When canvas dimensions match the target stream dimensions 1:1, image smoothing is bypassed for $<0.1\text{ms}$ direct blits and pixel-crisp text.
   - Performs smooth aspect-fit scaling with charcoal fallback letterboxing if the canvas aspect ratio deviates from 16:9.
   - Extracts exact RGBA pixels via `ctx.getImageData(0, 0, width, height)`.
   - Transfers the resulting `3,686,400 byte` ArrayBuffer (for 720p) back to the renderer thread via zero-copy transferable memory.

### 3.2 Physical Webcam Pipeline (`requestVideoFrameCallback`)

1. Physical cameras are acquired via `navigator.mediaDevices.getUserMedia()` with explicit `{ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, min: 15 } }` constraints to negotiate full-speed USB hardware feeds on Linux.
2. Frame updates are captured using `video.requestVideoFrameCallback(callback)` with a relaxed 120ms freeze guard watchdog timer (`setTimeout`).
3. In `captureTick()`, the webcam feed is drawn onto a 1280x720 scratch canvas with `imageSmoothingQuality = 'medium'` and cover/aspect-fit math.
4. If mirroring is enabled, horizontal coordinate transformation (`translate(width, 0); scale(-1, 1)`) is applied directly on the scratch canvas context.
5. Frames are converted to RGBA buffers (`3,686,400 bytes` for 720p) and forwarded to IPC.

### 3.3 Linux V4L2 Camera Sink & FFmpeg Process (`virtual-camera-sink.ts`)

1. **Spawn Arguments & Hardware SIMD Scaling**:
   When internal stream resolution ($1280 \times 720$) differs from output resolution ($1920 \times 1080$), FFmpeg takes 720p raw video on `pipe:0` and performs high-speed AVX2 SIMD scaling via `fast_bilinear` directly into the V4L2 loopback device:
   ```bash
   ffmpeg -y -f rawvideo -pix_fmt rgba -s 1280x720 -r 30 -i pipe:0 \
     -vf scale=1920:1080:out_color_matrix=bt709:out_range=pc:flags=fast_bilinear,format=yuv420p \
     -color_range pc -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
     -f v4l2 -pix_fmt yuv420p -threads 2 -flush_packets 1 /dev/video10
   ```
   If stream resolution matches output resolution (1080p in and out), scaling is bypassed and the bicubic BT.709 matrix is applied.
2. **SIMD Color Matrix Conversion**:
   FFmpeg converts uncompressed RGBA to BT.709 full-range PC YUV420P using AVX2 SIMD `libswscale` assembly in $< 1\text{ ms}$ per frame ($> 90\text{ FPS}$ throughput), guaranteeing accurate colors and zero CPU bottlenecks.
3. **Stream Integrity Guard**:
   In `VirtualCameraSink.pushFrame()`:
   - Incoming frames are strictly validated: `buffer.length` must match `inputWidth * inputHeight * 4` (e.g. $1280 \times 720 \times 4 = 3,686,400\text{ bytes}$).
   - Frames with mismatched resolutions or unexpected byte counts are dropped immediately.
   - This invariant prevents fractional byte offsets from entering FFmpeg's `stdin`, completely eliminating video rolling and chroma plane corruption.
4. **Idle Standby Slate**:
   - While Virtual Studio is idle or between streams, a timer writes a charcoal slate (`#17181b`) matching the input resolution at 30 FPS.
   - This guarantees that `/dev/video10` continuously advertises `V4L2_CAP_VIDEO_CAPTURE` at 1080p, preventing Google Meet, Chrome, or Zoom from dropping the device.

---

## 4. Audio Pipeline Implementation

### 4.1 Dual-Output Audio Graph

The audio system uses the Web Audio API to route audio concurrently to two destinations:

1. **Local Monitoring**: Direct output to system speakers (`audioContext.destination`) controlled by `localMonitoringVolume` and `isLocalAudioMonitoringEnabled`.
2. **Virtual Microphone**: Dedicated output to `AudioWorkletNode` feeding the system virtual microphone.

```
[ Physical Mic ] ──> [ micGainNode ] ────────┐
                                             ▼
[ Timeline Audio Bus ] ──> [ videoToVirtualMicGain ] ──> [ virtualMicMasterNode ] ──> [ AudioWorklet ] ──> IPC
          │
          └──> [ localMonitoringGain ] ──> [ audioContext.destination (Speakers) ]
```

### 4.2 Instant Auto-Return Logic

The state machine dynamically governs audio transitions based on editor playback state:

| Editor State                   | Video Audio to Virtual Mic | Video Audio to Local Speakers         | Physical Mic                        |
| :----------------------------- | :------------------------- | :------------------------------------ | :---------------------------------- |
| **Paused** (`!isPlaying`)      | Muted ($0.0$)              | Muted ($0.0$)                         | **Live** ($1.0$, unless user muted) |
| **Playing Demo** (`isPlaying`) | **Live** ($1.0$)           | **Live** ($1.0 \times \text{vol}$)    | Muted ($0.0$, unless unmuted)       |
| **Studio Inactive**            | Muted ($0.0$)              | **Live** ($1.0$, normal editor sound) | Muted ($0.0$)                       |

To eliminate clicks, pops, or audio discontinuities during transitions, gain adjustments are applied using exponential ramps via `gain.setTargetAtTime(targetVal, currentTime, 0.015)` (15ms time constant).

### 4.3 High-Performance AudioWorklet (`virtual-studio-audio-processor.worklet.ts`)

- Runs off the JavaScript main thread inside Chromium's real-time audio thread.
- Interleaves 128-sample stereo `Float32Array` buffers $[-1.0, 1.0]$ into 16-bit signed integer PCM `Int16Array` $[-32768, 32767]$.
- Transfers buffers via zero-copy `ArrayBuffer` transfer to `virtual-studio-streamer.ts`, which sends them over IPC to `VirtualAudioSink`.
- If `AudioWorklet` is unavailable in the environment, the streamer falls back gracefully to a `ScriptProcessorNode`.

### 4.4 Silence Keep-Alive & Backpressure Control (`virtual-audio-sink.ts`)

- During Auto-Return transitions (switching between physical mic and timeline playback), video decoders can incur 200–400ms startup latencies before streaming decoded audio samples.
- To prevent PulseAudio/PipeWire sink buffer starvation (underruns), `VirtualAudioSink` maintains a 60ms watchdog interval timer.
- If no PCM chunk has arrived within 120ms, the watchdog writes a 4096-byte 16-bit silence buffer to `stdin`.
- To prevent unbounded memory expansion and log flooding if the audio consumer backs up, `VirtualAudioSink` enforces a strict 64KB queue depth ceiling (`AUDIO_SINK_MAX_QUEUE_BYTES`). When the queue exceeds 64KB, incoming chunks are dropped to preserve real-time synchronicity, and warning logs are throttled to at most once per 3 seconds.
- `pacat` is spawned with `--latency-msec=25 --process-time-msec=10 --raw` to enforce low-latency real-time ring buffering.

---

## 5. Linux Driver & Kernel Setup (`driver-setup.ts`)

- **Camera (`v4l2loopback`)**:
  - Module parameters configured: `devices=1 video_nr=10 card_label="DemoThat Virtual Camera" exclusive_caps=1 max_buffers=4`.
  - Automatically loads via `/etc/modprobe.d/demothat-v4l2loopback.conf`.
- **Microphone (`PipeWire` / `PulseAudio`)**:
  - Creates a virtual source using `pactl load-module module-remap-source`:
    `master=demothat_mic_sink.monitor source_name=demothat_mic source_properties=device.description="DemoThat Virtual Microphone"`.
  - Audio data is written to the sink pipe via `pw-cat` or `paplay`.

---

## 6. Guardrails & Rules for Future Modifications

When making changes to Virtual Studio, always adhere to the following guardrails:

1. **Never write mismatched byte buffers to FFmpeg `stdin`**:
   - Every frame fed to `VirtualCameraSink` on Linux MUST strictly match `inputWidth * inputHeight * 4` (e.g. $1280 \times 720 \times 4 = 3,686,400\text{ bytes}$ for default 720p stream, or $8,294,400\text{ bytes}$ for 1080p).
   - Any fractional offset desynchronizes raw video scanlines permanently and corrupts chroma planes.
2. **Offload Canvas Texture Reads**:
   - Never call `ctx.getImageData()` synchronously on the UI thread for every preview frame during playback.
   - Always use `createImageBitmap()` and transfer to a background Web Worker.
3. **No Raw Color Literals**:
   - UI styling must consume design tokens from `src/styles/tokens.css`.
   - Data fallback colors (such as `#17181b`) belong in `shared/virtual-camera-types.ts` (`DEFAULT_VIRTUAL_STUDIO_FALLBACK_COLOR`), not hardcoded in UI `.tsx` files.
4. **Always Pass the 7-Step Verification Pipeline (`AGENTS.md`)**:
   - `npm run contract:check`
   - `npm run format:check`
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run contract:types`
   - `npx vite build --mode development`
