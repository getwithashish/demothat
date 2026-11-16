# Fast Video Export Pipeline: Architecture & Optimization Guide

This document explains the architecture, design rationale, and optimization strategies of DemoThat's high-performance video export pipeline. It serves as a guide for maintainers and future engineers seeking to understand, debug, or extend the export engine.

---

## 1. Background & The Fundamental Bottleneck

In an Electron-based video editor, high-resolution video exports require rendering canvas overlays (smooth cursor paths, click ripples, camera zooms, 3D perspective tilts, webcams, and visual effects) synchronized frame-by-frame with underlying video recordings.

### The Long-GOP Seek Bottleneck

Standard video recordings (such as screen captures encoded by x264, NVENC, or MediaRecorder) use **Long-GOP (Group of Pictures)** compression. In a long-GOP stream:

- Keyframes (IDR / I-frames) occur infrequently (e.g. every 2 to 5 seconds).
- Intermediate frames (P-frames and B-frames) only store deltas relative to earlier or later frames.
- When Chromium's `<video>` element seeks (`video.currentTime = t`), the media decoder must discard its decode buffer, seek back to the prior keyframe, and decode all intermediate P/B frames sequentially up to $t$.
- Under real workloads, each arbitrary seek in Chromium takes **35ms to 200ms**.
- For a 30-second recording at 30 FPS (900 frames), sequential seeking alone accounts for $900 \times 100\text{ms} = 90\text{ seconds}$ of pure waiting time, completely starving the CPU and encoder.

---

## 2. The Hybrid Pipeline Architecture

To achieve near-instant exports ($\le 1\times$ realtime duration) without sacrificing 100% visual effect fidelity or audio synchronization, DemoThat employs a **Hybrid Intra-Proxy & Parallel Chunk Pipeline**:

```
                       [ Source Video (.mp4 / .webm) ]
                                      │
                   ┌──────────────────┴──────────────────┐
                   ▼                                     ▼
      [ Async Intra-Proxy Generator ]        [ Worker Window Pool Init ]
       - FFmpeg: keyint=1, ultrafast          - Spawns N BrowserWindows
       - Transcodes at 16x realtime           - Dedicated IPC channels
       - Every frame is an IDR frame          - Pre-allocates canvas surfaces
                   │                                     │
                   └──────────────────┬──────────────────┘
                                      │ (Intra-Proxy Ready: <2s)
                                      ▼
                        [ Slice Planner (planChunkSlices) ]
                         - Worker 0: frames [0 .. F/4)
                         - Worker 1: frames [F/4 .. 2F/4)
                         - Worker 2: frames [2F/4 .. 3F/4)
                         - Worker 3: frames [3F/4 .. F)
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            ▼                         ▼                         ▼
   [ Worker #0 (Chunk 0) ]   [ Worker #1 (Chunk 1) ]   [ Worker #N (Chunk N) ]
   - Sub-7ms frame seeks     - Sub-7ms frame seeks     - Sub-7ms frame seeks
   - drawScene() canvas      - drawScene() canvas      - drawScene() canvas
   - Pipe raw RGBA to FFmpeg - Pipe raw RGBA to FFmpeg - Pipe raw RGBA to FFmpeg
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      ▼
                        [ Lossless Concat & Audio Mux ]
                         - Concat demuxer (-c:v copy)
                         - Monotonic PTS generation (+genpts)
                         - Multi-track audio mix & alignment
                                      ▼
                           [ Final Master MP4 ]
```

---

## 3. Core Components & Implementations

### 3.1 All-Intra Proxy Generation (`electron/main/features/fast-intra-proxy.ts`)

- **Mechanism**: Pre-transcodes the source video to an all-intra temporary file where every frame is an independent IDR frame (`keyint=1`, `-g 1`).
- **Flags**:
  ```bash
  -threads 0 -c:v libx264 -g 1 -preset ultrafast -tune fastdecode -flags:v +low_delay -crf 19 -an -sn -dn
  ```
- **Performance Impact**:
  - Transcoding runs at **15–18x realtime** (~2.19s for a 35s 1080p source).
  - Chromium `<video>` seek time drops from **35–200ms to 6.7ms per frame**.
  - Aggregate seek throughput increases to **>600 FPS** across parallel workers.
- **Fail-Safe**: If FFmpeg fails or cannot read the source, it gracefully falls back to the original source path.

### 3.2 Pipelined Asynchronous Startup (`electron/main/features/export-manager.ts`)

- **Mechanism**: Intra-proxy generation is launched via `Promise.all([screenProxy, webcamProxy])` concurrently in the background while `BrowserWindow` instances and chunk FFmpeg processes initialize.
- **Result**: By the time worker windows mount and signal `render:ready`, the intra-proxy is already complete, reducing perceived startup delay to under 1 second.

### 3.3 Dynamic Slice Planning & CPU Budgeting (`electron/main/features/build-export-args.ts`)

- **Worker Allocation**:
  - Evaluates CPU cores and total frame count (`computeChunkWorkerCount`).
  - Scales dynamically: 2 workers (dual-core), 3 workers (quad-core), 4 workers (6-core), 6 workers (8-core), up to 8 workers (12+ cores).
- **Thread Budgeting**:
  ```ts
  const workerThreads = Math.max(1, Math.min(4, Math.floor(cpuCount / numWorkers)))
  ```
  Allocating a bounded thread budget per worker prevents 8 simultaneous FFmpeg processes from competing for all CPU threads, eliminating CPU cache thrashing and context-switching bottlenecks.

### 3.4 Frame Boundary Pre-Seeking & Mid-Frame Sampling (`src/pages/RendererPage.tsx`)

- **Pre-Seeking Chunk Starts**:
  - Non-zero chunk workers (`startFrame > 0`) must seek from 0s to their slice start before rendering.
  - Pre-seeking occurs _before_ entering the render loop, guaranteeing that video elements are fully settled (`readyState >= 2`) before frame 0 is drawn. This prevents black screen frames at chunk boundaries.
- **Mid-Frame Sampling**:
  - Canvas drawing uses exact timeline presentation timestamp: `nominalTimestamp = frame / fps`.
  - Video decoder seeks to mid-interval: `seekTimestamp = (frame + 0.5) / fps`.
  - **Why**: Pure left-boundary sampling (`frame / fps`) is susceptible to floating-point truncation in integer timebases, causing decoders to decode the previous frame repeatedly. Mid-interval sampling ensures the playhead securely lands in the target frame's presentation window.

### 3.5 Bounded In-Flight Write Pipeline (`src/pages/RendererPage.tsx`)

- **Mechanism**: Maintains a sliding window (`MAX_IN_FLIGHT = 6`) of unresolved frame IPC writes.
- **Why**: Keeps Chromium's canvas rendering and FFmpeg's encoding pipeline operating concurrently while preventing unbounded memory consumption across Electron IPC.

### 3.6 Memory-Efficient Rendering & Caching (`src/lib/renderer.ts`)

- **Shadow Canvas Caching**:
  - Main video and webcam shadows are cached in a bounded `shadowCacheMap = new Map<string, CachedShadow>()`.
  - Eliminates allocating and discarding thousands of `HTMLCanvasElement` instances and 2D contexts on every frame.

### 3.7 Chromium Foreground Priority (`electron/main/index.ts`)

- **Mechanism**: Passes `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`, and `--disable-backgrounding-occluded-windows` to Chromium at startup.
- **Why**: Prevents Chromium's compositor from treating hidden (`show: false`) export worker windows as low-priority background tabs.

### 3.8 Lossless Stitching & Monotonic Timestamps (`electron/main/features/build-export-args.ts`)

- **Mechanism**: Uses FFmpeg's concat demuxer with `-c:v copy` and `-fflags +genpts`.
- **Result**: Chunks are joined losslessly in **<0.1 seconds** with monotonic timestamps, sample-accurate audio multiplexing, and zero transcode generational loss.

---

## 4. Key Performance Benchmarks (1080p @ 30 FPS)

| Metric                                                            | Sequential Baseline | Hybrid Fast Pipeline                        |
| :---------------------------------------------------------------- | :------------------ | :------------------------------------------ |
| **35-Second Video Export**                                        | ~122 seconds        | **~12–18 seconds**                          |
| **Realtime Ratio** ($\frac{\text{Export Time}}{\text{Duration}}$) | 3.50x (Slow)        | **0.35x–0.50x (2–3x faster than realtime)** |
| **Per-Frame Video Seek Latency**                                  | 35–200ms            | **6.7ms**                                   |
| **Worker Concurrency**                                            | 1 process           | **4–8 parallel processes**                  |
| **Canvas Allocations per Run**                                    | >2,200 allocations  | **0 (Reused cache)**                        |
| **Visual Fidelity**                                               | Full effects        | **100% full effects & audio sync**          |

---

## 5. Guide for Future Optimizations

Future maintainers looking to push export performance even further should consider the following avenues:

### 1. OffscreenCanvas in Web Workers

- **Concept**: Transfer canvas rendering to headless Web Workers (`OffscreenCanvas`) instead of spawning full `BrowserWindow` instances.
- **Considerations**: Currently, Chromium does not support `<video>` playback directly inside pure Web Workers without `VideoDecoder` or `ImageBitmap` streams. If WebCodecs video frame demuxing matures, worker windows can be replaced with lightweight worker threads.

### 2. Hardware-Accelerated Intra Proxy

- **Concept**: Use GPU hardware encoders (`h264_nvenc`, `h264_vaapi`, `h264_videotoolbox`) for the intra-proxy step if available on the host system.
- **Current Status**: Bundled static Linux FFmpeg binaries lack dynamic VA-API/NVENC drivers, but macOS (`videotoolbox`) and Windows (`nvenc`/`qsv`) can leverage hardware encoders when detected via `EncoderCapabilities`.

### 3. Zero-Copy Shared Memory IPC

- **Concept**: In Electron, transferring large `Uint8Array` frame buffers over `ipcRenderer.invoke` incurs structured clone overhead.
- **Future Enhancement**: If Electron introduces native SharedArrayBuffer transfers across renderer and main process for Node streams, frame transfer latency can be reduced to zero.
