# Agent prompt — `demothat` (desktop app)

> This file is the standing brief for cloud/Pro work in this repository. Every agent
> (and every later contributor) must read it, plus
> [`docs/SHARED_SPEC.md`](./SHARED_SPEC.md) — **Section 0 is the specification** —
> before writing code.
>
> **Sequencing:** this work comes after the first brief's Phases 1 to 3 (`.dthat`
> projects, pipeline fixes, 8K export) are merged, because it reuses the autosave, the
> upscale detection and the estimator from them.
>
> **Conflicts:** where this prompt conflicts with the first brief's Section 8.2
> (entitlement stub) or Section 9 (cloud client), **this prompt wins**.
>
> **Contract:** `demothat-api` owns the contract. This repo vendors a pinned copy of
> `contract/openapi.yaml` plus the JSON Schemas in its own `contract/` folder with a
> version header, and CI fails when the version differs from the one this repo declares
> it targets. Propose contract changes in the API repo first.

---

You are extending the DemoThat Electron app (a ScreenArc fork) with Pro licensing, credits and cloud upscaling that talks to `demothat-api`. Read Section 0 fully first. This work comes **after** the first brief's Phases 1 to 3 (`.dthat` projects, pipeline fixes, 8K export) are merged, because it reuses the autosave, the upscale detection and the estimator from them. Where this prompt conflicts with the first brief's Section 8.2 (entitlement stub) or Section 9 (cloud client), this prompt wins.

### Ground rules

- Follow the existing repo conventions: Conventional Commits (semantic-release drives releases), vitest, lint and format checks, the token-based styling and the existing `src/components/ui/` primitives.
- Match the visual designs in `docs/design/cloud-ui-variants.html` (a static reference file the owner will add to the repo). Variant **A** in each section is the default pick. Reproduce the layout, copy and states. Use the icon library the app already uses. **Do not rely on an icon font**, and keep numeric text on one line (`whitespace-nowrap`).
- The API base URL, the Dodo checkout host allowlist and the JWT public key are configuration constants in one file. Never put server secrets in the app.
- All network code lives in the main process. The renderer talks to it through typed IPC added in `electron/preload.ts` and `electron-env.d.ts`.

### Tasks (stop after each numbered group with a summary)

**C1 License and credits core**

- `electron/main/features/license-client.ts`: compute a device ID hash (`node-machine-id` plus an app salt, SHA-256, never the raw ID), activate a key through `POST /v1/license/activate` with a readable device label, store the key and token with Electron `safeStorage` (not `electron-store`), verify the JWT with the embedded public key using `jose`, expose `getEntitlement()` (replacing the earlier stub: offline Pro works until the token expires, credits need the network), `listDevices`, `deactivateDevice`.
- A `licenseSlice` in the Zustand store: `plan`, `balance`, `status` (`normal`, `low`, `empty`), `refreshBalance()`. The low threshold is a constant (default 100 credits). Refresh on app start and on window focus.
- Components (variants from the reference file): `CreditCapsule` in the editor header (PRO badge, balance, Buy), `ActivationDialog` (paste a key), `DevicesDialog` (list, current device marked, Deactivate).

**C2 Purchase flow** (full sequence in the owner's diagram: the system browser opens, the app polls)

- Buy credits or Get Pro calls `POST /v1/checkout`. Validate the returned `checkoutUrl` (https, host in the allowlist), open it with `shell.openExternal`, and show `WaitingForPaymentDialog` with Copy link and Cancel.
- Poll `GET /v1/purchases/:id` with the poll token every 2 seconds for up to 15 minutes, with backoff on network errors. Persist the pending `purchaseId` and poll token (in `safeStorage`) so polling resumes after a restart. Also refresh on window focus.
- On success: for a first purchase, take the returned `licenseKey` and activate automatically (the email is only a backup). For a top-up, update the balance. Then play the credit count-up on the capsule and show `CreditsAddedToast`. If an export was waiting for credits, resume it.
- Handle `failed` (message with Try again), timeout (message that credits will be added automatically), and `device_limit_reached` (open the Devices dialog with the list from the error).

**C3 Cloud export flow (render locally, upscale in the cloud)**

- Preflight before any rendering: estimate the cost from `GET /v1/capabilities` (`creditsPerFrame`) and the project length. If the balance is lower, show `OutOfCreditsDialog` (balance versus needed) and stop. The line 'Your project and edits are saved' is only shown after the project was actually autosaved to a `.dthat` file (use Phase 1's save). Otherwise omit the line.
- First cloud use shows `CloudConsentDialog` (what is uploaded, how long it is kept, what it costs), remembered afterwards.
- Orchestrator in `electron/main/features/cloud-export.ts` with stages: Rendering locally, Uploading, Validating, Waiting for GPU, Upscaling, Downloading, Done. Render to an intermediate file as in the first brief. Upload with a multipart upload to the presigned URLs (3 parts in parallel, retry each part, persist `uploadId` and the finished parts so an interrupted upload resumes), then call `upload/complete` and `start`. Poll `GET /v1/jobs/:id` every 2 seconds. Download to a temporary file with resume, then rename atomically to the chosen output path.
- `CloudExportProgress` shows the stage, a progress bar, the ETA, and a credits meter (used so far out of reserved, from `consumed` and `reserved`).
- **Cancel behavior (implements Section 0.3):** the Cancel button opens `CancelExportDialog` with text that depends on the stage. While rendering, uploading, validating or waiting for a GPU, it says no credits are used. While upscaling, it says 'You've used about X credits so far. Cancel now and X are charged (minimum Y); the rest is returned', with X taken from the latest poll. After the user confirms, call `DELETE /v1/jobs/:id` and wait for the final state, then show a toast with the exact `charge` and `refund` from the API. Never compute the charge in the client. The server's numbers are final.
- Failures: after a failure, show the server's `refund` (infrastructure failures are fully refunded). If local rendering already succeeded, keep the intermediate file and offer Retry or 'Export with Standard upscaling'.
- A job that is still running when the app is closed continues on the server. On the next start, look for a persisted active `jobId` and offer to resume watching it.
- Insufficient credits at the server probe step (`rejected` with `insufficient_credits`) shows the empty dialog with the exact cost.

**C4 Export modal integration.** Use the first brief's `isUpscale` detection. Show Pro badges, the method choice (Standard local versus AI cloud) with estimated time and credit cost per method, and block cloud export without a valid license. Keep Standard local upscaling available to licensed users per the first brief.

**C5 Tests and acceptance.** Unit tests for the checkout URL validation, poll resume logic, cost estimation, and the dialog text per stage. A mock API server script (so the UI runs without the real backend) that can simulate: first purchase, top-up, payment failure, 402, a job that is canceled while running (returning charge and refund), and an infrastructure failure. Manual checklist in the summary: first purchase to activated Pro, top-up count-up, out-of-credits dialog, cancel during upload (no charge), cancel while upscaling (partial charge shown), device limit.

Definition of done: lint, types and tests pass, all UI states from the reference file exist, and no server secret or Dodo API key appears anywhere in the repo.
