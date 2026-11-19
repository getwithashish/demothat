# Logging & Performance Telemetry: Architecture & Implementation Guide

This document explains the architecture, design principles, and technical implementation of DemoThat's **Logging and Performance Telemetry** system. It serves as an authoritative guide for maintainers, future engineers, and AI agents seeking to understand, debug, or extend logging across the application.

---

## 1. Overview & Industry Standards

DemoThat employs a multi-tier, environment-aware logging architecture powered by [`electron-log` v5](https://github.com/megahertz/electron-log) and custom telemetry probes.

Key capabilities include:

- **Environment-Aware Log Levels**: Automatic level configuration tailored to `development`, `staging`, and `production`.
- **Terminal Visibility for Local Development**: Structured timestamps, log levels, scopes, and colors printed directly to terminal stdout/stderr during `npm run dev`.
- **Rotating File Storage**: Automatic file archiving (up to 3 rotated files) stored in the standard operating system application data directory.
- **IPC Telemetry & Argument Sanitization**: Automatic measurement of IPC call execution duration in milliseconds, with automatic redaction of sensitive credentials (tokens, passwords, keys) and summary truncation of large binary buffers/data URLs.
- **FPS & Performance Metrics**: Real-time FPS telemetry for WYSIWYG canvas rendering, video playback, virtual camera sink ingestion, and webcam hardware capture.
- **System Resource Diagnostics**: On-demand and periodic CPU, process memory (RSS, heap), OS memory, and active window telemetry.

---

## 2. Environment Configuration Matrix

The logging system detects the active runtime environment in `electron/main/lib/logging.ts`:

| Environment     | Criteria                                          | Console Level        | File Level     | File Rotation                                             | Telemetry Probe                   |
| :-------------- | :------------------------------------------------ | :------------------- | :------------- | :-------------------------------------------------------- | :-------------------------------- |
| **Development** | `!app.isPackaged` or `NODE_ENV === 'development'` | `debug` (verbose)    | `debug` (5 MB) | Default                                                   | Periodic 10s interval & on-demand |
| **Staging**     | `DEMOTHAT_ENV === 'staging'` or pre-release beta  | `info`               | `info` (10 MB) | Up to 3 archives                                          | On-demand on key operations       |
| **Production**  | Packaged build (`app.isPackaged === true`)        | `warn` (errors only) | `info` (10 MB) | Up to 3 archives (`main.log`, `main.1.log`, `main.2.log`) | On-demand error logging only      |

### Console Log Format

`[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{scope}] {text}`

---

## 3. Architecture & Process Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             RENDERER PROCESS                                │
│                                                                             │
│  [ UI Components / Pages ] ──> [ src/lib/logger.ts (createScopedLogger) ]   │
│  [ Store Slices (Zustand)] ──> [ src/lib/logger.ts (createScopedLogger) ]   │
│  [ Preview.tsx (FPS Probe)] ──> [ src/lib/logger.ts (createScopedLogger) ]  │
│                                                          │                  │
│                                                          ▼                  │
│                                              `electron-log/renderer`        │
│                                                          │                  │
└──────────────────────────────────────────────────────────┼──────────────────┘
                                                           │ IPC Bridge
                                                           │ (__ELECTRON_LOG_IPC__)
┌──────────────────────────────────────────────────────────┼──────────────────┐
│                                                          ▼                  │
│                                                `electron-log/main`          │
│                                                          │                  │
│  ┌───────────────────────────────────────────────────────┴───────────────┐  │
│  │                    electron/main/lib/logging.ts                       │  │
│  │                                                                       │  │
│  │  - Console Transport: terminal output with colors and timestamps      │  │
│  │  - File Transport: rotating log files in appData                      │  │
│  │  - IPC Instrumenter (instrument.ts): duration & sanitized arguments  │  │
│  │  - System Resource Probe (system-resource-probe.ts): CPU/RAM stats    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                               MAIN PROCESS                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Key Components

### 4.1 Main Process Logging (`electron/main/lib/logging.ts`)

- Calls `log.initialize()` to establish IPC listeners for the renderer process.
- Registers global handlers for `process.on('uncaughtException')` and `process.on('unhandledRejection')`.
- Manages log rotation in production, ensuring logs never consume unbounded disk space.

### 4.2 System Resource Probe (`electron/main/lib/system-resource-probe.ts`)

- Collects:
  - **CPU**: Sampling delta percentage, user/system microseconds, and OS load averages (`os.loadavg()`).
  - **Process Memory**: Resident Set Size (`rss`), heap total, heap used, and external memory in megabytes (`process.memoryUsage()`).
  - **Host RAM**: Total memory, free memory, used memory, and percent utilization (`os.totalmem()`, `os.freemem()`).
  - **Electron Windows**: Count of total, visible, focused, and minimized `BrowserWindow` instances.
- Starts a periodic 10-second background probe in development (`.unref()` timer so it does not block application teardown).
- Provides `logSystemResources(tag)` for snapshot logging before and after heavy operations (exports, recordings, cloud jobs).

### 4.3 IPC Telemetry & Argument Sanitization (`electron/main/ipc/instrument.ts`)

- Wraps `ipcMain.handle` and `ipcMain.on` invocations.
- Measures execution duration in milliseconds using `performance.now()`.
- Recursively sanitizes arguments (up to depth 3):
  - Redacts sensitive credential keys (`token`, `secret`, `key`, `password`, `apiKey`, `authorization`).
  - Summarizes binary buffers (`Uint8Array`, `Buffer`, `ArrayBuffer`) as `"[Uint8Array (8,294,400 bytes)]"`.
  - Truncates strings exceeding 200 characters and data URLs (`"data:image/jpeg;base64,..."` -> `"[data:image/jpeg;base64, 4520 chars]"`).
- Samples high-frequency 30–60 Hz streaming channels (`virtual-studio:push-frame`, `virtual-studio:push-audio`, `recording:write-*`) at 1 in 100 calls to avoid terminal flooding.

### 4.4 Centralized Renderer Logger (`src/lib/logger.ts`)

- Exposes `createScopedLogger(scope: string)`.
- Wraps `electron-log/renderer` with fallback to native `console` in test runners (Vitest/JSDOM) or detached contexts.
- Automatically prepends `[scope]` tag to messages.

---

## 5. Performance & FPS Telemetry

### 5.1 Editor Canvas & Playback FPS (`src/components/editor/Preview.tsx`)

During timeline playback:

- Tracks rendered frame counts and dropped frames.
- Every 3.5 seconds, computes and logs:
  - Current rendering FPS.
  - Playhead timestamp.
  - Dropped frames count.
  - Duration window.

### 5.2 Virtual Camera Sink Telemetry (`electron/main/features/virtual-studio/virtual-camera-sink.ts`)

- Measures frames pushed to the FFmpeg V4L2 pipe.
- Every 5 seconds during active streaming, logs:
  - Throughput FPS.
  - Total frames sent.
  - Dropped frames (mismatched resolution or buffer sizes).
  - Backpressure drain events.
  - FFmpeg `stdin.writableLength` queue depth.

### 5.3 Physical Webcam Hardware Capture (`src/features/virtual-studio/services/virtual-studio-streamer.ts`)

- Tracks `video.requestVideoFrameCallback` frequency.
- Every 3 seconds, logs camera hardware deliver rate (FPS).
- Tracks canvas worker transfer latency and background OffscreenCanvas render duration.

---

## 6. How to Use Logging in New Modules

### In Main Process Files:

```typescript
import { createScopedLogger } from '../lib/logging'
const logger = createScopedLogger('MyFeature')

logger.info('Starting feature operation', { id: 123 })
logger.debug('Internal calculation result:', result)
logger.warn('Non-fatal retry encountered:', warning)
logger.error('Operation failed:', error)
```

### In Renderer Process Files:

```typescript
import { createScopedLogger } from '../../lib/logger'
const logger = createScopedLogger('MyComponent')

logger.info('User initiated action', { actionId: 'export' })
logger.debug('Current state snapshot:', state)
```

---

## 7. Style Guardrails & Best Practices

1. **Zero Color Literals**: Never include `#hex` or `rgb()` color codes in `.ts`/`.tsx` files outside `tokens.css`. Use logger scopes, not raw color codes.
2. **Never Log Sensitive Data**: Tokens, API keys, passwords, and user license secrets must always be redacted.
3. **Use Scoped Loggers**: Always use `createScopedLogger('FeatureName')` rather than anonymous global loggers to make terminal output easy to filter and search.
