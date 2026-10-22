# Section 0 — Shared spec

**Applies to all three repos: `demothat` (desktop), `demothat-api`, `demothat-worker`.**
This is the specification. Read it fully before writing code in any of them.

The cost of splitting is contract drift, so one rule applies: **the API repo owns the contract.** It holds `contract/openapi.yaml` (app to API) and `contract/worker-protocol.md` plus JSON Schemas (API to worker). The other two repos vendor a pinned copy in their own `contract/` folder with a version header, and CI fails if the version differs from the one the repo declares it targets. Any contract change is made in the API repo first.

## 0.1 Architecture

```
Electron app --HTTPS--> demothat-api (Vercel) --> MongoDB Atlas (free tier)
   |                         |  |
   |                         |  +--> Dodo Payments (checkout, license keys, webhooks)
   |                         +-----> demothat-worker (Modal) via HTTPS 'worker protocol'
   +--presigned PUT/GET--> Cloudflare R2 <--presigned GET/PUT-- worker
```

- The desktop app renders the video locally (existing pipeline), then uploads that rendered video to R2. The `.dthat` file never leaves the machine.
- The worker upscales with Real-ESRGAN, scales to the exact target size, encodes, and uploads the result to R2. The app downloads it.
- **Transcription rides the same rails.** The app extracts the recording's audio track locally (16 kHz mono M4A, a few MB), uploads it, and the worker transcribes it on a **CPU** container and uploads a transcript JSON. Captions are the app's business: the worker returns timings and text, never styling.
- Provider flexibility: the API only knows the worker through the HTTP worker protocol (Section 0.7). Moving to another GPU provider means hosting the same container behind the same three endpoints. Nothing in the API or the app changes except the `WORKER_BASE_URL`.

## 0.2 Decisions already made by the owner

- $3 buys a **Pro license plus 1,800 credits**. Top-up packs use the same 600 credits per dollar unless configured otherwise in `PRODUCTS`.
- A license key works on up to **10 devices**.
- Payments: Dodo Payments (merchant of record) with its native license keys. Stripe is not available in India.
- Database: MongoDB Atlas free tier. Hosting: Vercel (API), Modal (GPU), Cloudflare R2 (storage). Modal cold starts are acceptable.
- Credits per frame are a **config table** (`CREDITS_PER_FRAME` by target resolution). Ship placeholder values with a clear TODO. The owner will set real values from the worker benchmark. Do not do margin analysis.
- Transcription is priced **per minute of audio** (`TRANSCRIBE_CREDITS_PER_MINUTE`), defaulting to the cost of a 30 fps 1080p cloud upscale of the same clip, so it starts out priced like the export it accompanies. One variable re-prices it; the app mirrors the published number for its estimate and never sends a price of its own.
- Transcription uses the **most accurate Whisper size** (`large-v3`), not the fastest. It runs on CPU in its own image, so a transcription never occupies — or pays for — a GPU container.

## 0.3 Credit and settlement policy (the important part)

Credits are charged for **frames actually upscaled**. Canceling mid-way charges for the work done and returns the rest. Charging by usage is fairer than refunding everything on cancel (which would let users start and cancel indefinitely for free GPU time) and fairer than refunding nothing.

- `totalFrames = ceil(durationSec * fps)` taken from the **server-side probe** of the uploaded file, never from client numbers.
- `cost = ceil(totalFrames * CREDITS_PER_FRAME[target])`.
- **Start:** reserve the full `cost` atomically. If the balance is lower, reject (HTTP 402, code `insufficient_credits`, with `cost` and `balance`). No GPU time is spent in that case.
- **Progress:** the worker sends a heartbeat about every 5 seconds with `framesDone`. The server keeps `max(framesDone)`, and `consumed = ceil(framesDone * CREDITS_PER_FRAME[target])`.
- **Finalize (exactly once)**, `charge` and `refund = reserved - charge`:
  - Succeeded: `charge = cost`.
  - Canceled by the user, or failed because of the user's input: if the worker never reached `running` (still queued or cold-starting), `charge = 0`. Otherwise `charge = min(cost, max(MIN_CHARGE_CREDITS, consumed))`. `MIN_CHARGE_CREDITS` defaults to 10 and is configurable, so start-and-cancel is never free once GPU work began.
  - Failed for an infrastructure reason (worker crash, timeout, no heartbeat, unknown error): `charge = 0`, full refund.
- Canceling during local rendering or uploading costs nothing, because nothing was reserved yet. After a job has **succeeded**, the charge is final and the download can be retried for 24 hours at no cost.
- No partial video is delivered after a cancel.
- **Exactly-once settlement:** compare-and-set on the job (`finalizedAt` is null), then in one transaction write the ledger entry with idempotency key `job:<id>:settle` and apply the balance change.
- **Stale jobs:** if no heartbeat arrives for 3 minutes, finalize from the last known `framesDone` as an infrastructure failure (full refund). Do this lazily whenever a job is read, and also from `POST /internal/reap` as a backstop, because Vercel cron frequency is limited.

### 0.3.1 Transcription: the same policy in a different unit

A transcription is the same lifecycle priced in **minutes of audio probed** rather than frames upscaled. Every rule above applies unchanged — reserve up front, exactly-once settlement, the same refund table — with `audioSeconds` in place of `totalFrames`:

- `audioSeconds` comes from the **server-side audio probe** of the uploaded track. The length the app declares at create time is a preflight only, exactly as `durationSec` is for an upscale.
- `cost = ceil(audioSeconds / 60 * TRANSCRIBE_CREDITS_PER_MINUTE)`.
- **Progress:** heartbeats carry `audioSecondsDone`; the server keeps `max(audioSecondsDone)` and `consumed = ceil(audioSecondsDone / 60 * TRANSCRIBE_CREDITS_PER_MINUTE)`.
- **Finalize:** identical to 0.3 using that `consumed` — 0 before the worker reached `running`, `min(cost, max(MIN_CHARGE_CREDITS, consumed))` after it, and a full refund for an infrastructure failure.
- **Never price a transcription from `framesDone`.** It has no frames, so a frame-based charge would be 0. The job's `kind` decides which counter and which rate apply — in the API, and in anything else that reads a job.
- **No partial transcript is delivered after a cancel**, for the same reason no partial video is: a transcript that stops mid-sentence is not a deliverable, and the charge already covers the work done.

## 0.4 Job state machine

`created` (credit preflight passed) then `uploading`, `uploaded`, `validating` (worker probe), then either `rejected` (limits or insufficient credits) or `queued`, then `running`, then `succeeded`, `failed`, `canceling` and `canceled`, finally `expired` (after retention). Transitions only go forward, and every transition is a compare-and-set on the previous status.

Every job also carries a **`kind`**: `upscale` or `transcribe`. The states are shared; what differs is the unit the job advances and what the worker uploads at the end.

## 0.5 Data model (MongoDB)

- `licenses`: `_id`, `dodoLicenseKeyId`, `keyHash` (SHA-256, unique), `customerId`, `email`, `status` (`active`, `revoked`), `plan`, `creditsBalance`, `activationLimit` (10), `createdAt`.
- `devices`: `licenseId`, `dodoInstanceId`, `deviceIdHash`, `label`, `platform`, `active`, `activatedAt`, `lastSeenAt`. Unique on (`licenseId`, `deviceIdHash`).
- `purchases`: `_id`, `pollTokenHash`, `licenseId?`, `productId`, `dodoSessionId`, `dodoPaymentId?`, `status` (`pending`, `succeeded`, `failed`), `lastDodoCheckAt`, `encryptedLicenseKey?` (until delivered to the app once, 24 h TTL), `createdAt`. TTL index of 30 days.
- `ledger` (append-only): `licenseId`, `type` (`topup`, `reserve`, `settle`, `refund`, `reversal`, `adjust`), `amount` (signed), `jobId?`, `purchaseId?`, `idempotencyKey` (**unique**), `balanceAfter`, `createdAt`.
- `jobs`: `_id`, `licenseId`, `deviceId`, `status`, `kind` (`upscale` | `transcribe`), `source` (`bucketKey`, probe results), `target` (`width`, `height`), `totalFrames`, `cost`, `reserved`, `framesDone`, `lastHeartbeatAt`, `cancelRequested`, `workerRunId`, `callbackSecretHash`, `charge?`, `refund?`, `finalizedAt?`, `errorCode?`, `createdAt`, `expiresAt` (TTL index). A transcription job additionally carries `audioSeconds` (probed), `audioSecondsDone`, `creditRatePerMinute` (the rate it was priced at, kept so a later config change cannot re-price settled work), `language?` and `transcribeModel?`.
- `webhookEvents`: `eventId` (**unique**), `receivedAt` (TTL 30 days).
- Balance changes: ledger insert plus conditional `$inc` in one transaction. A deduction must use a filter like `{ _id, creditsBalance: { $gte: n } }` and check that a document matched. Atlas free tier is a replica set, so transactions should work, but verify in tests with `MongoMemoryReplSet`.

## 0.6 Client API (app to API)

Auth: `Authorization: Bearer <token>` (JWT, EdDSA) where noted. JSON everywhere, zod-validated, errors as `{ error: { code, message } }`.

- `GET /v1/capabilities`: `creditsPerFrame` table, supported targets, limits (max duration, max target), models, `minChargeCredits`, `cloudEnabled`, and `transcription: { enabled, creditsPerMinute, models, maxAudioSeconds }` — what the app quotes a transcription from.
- `POST /v1/checkout` (token optional): `{ productId, deviceIdHash? }` returns `{ purchaseId, pollToken, checkoutUrl }`. With a token this is a top-up for that license. Without one it is a first purchase.
- `GET /v1/purchases/:id` (header `X-Poll-Token`): `{ status, balance?, licenseKey? }`. The key is returned **once** on a first purchase, then removed. Each call may trigger a throttled Dodo payment-status check (at most every 2 s per purchase).
- `GET /thanks`: static page, 'Payment received, return to DemoThat'. It never grants anything.
- `POST /webhooks/dodo`: signature-verified (see Dodo docs), deduplicated by event ID, handles payment succeeded, failed, refund and dispute.
- `POST /v1/license/activate` (no token): `{ licenseKey, deviceIdHash, label, platform }` returns `{ token, balance, devices }`, or `device_limit_reached` with the device list.
- `GET /v1/license` (token): `{ plan, balance, devices }`. `DELETE /v1/devices/:id` (token): deactivates a device through Dodo.
- `POST /v1/jobs` (token): `{ sourceWidth, sourceHeight, fps, durationSec, fileSizeBytes, targetWidth, targetHeight }`. It does a **credit preflight** with the declared numbers, returning 402 with `estimatedCost` if the balance is lower. Otherwise it returns `{ jobId, estimatedCost, upload }`. For files above the multipart threshold, `upload` is `{ type: 'multipart', uploadId, partSize, partUrls[] }`, else `{ type: 'single', url }`.
- `POST /v1/jobs/transcribe` (token): `{ audioSeconds, fileSizeBytes, language?, model? }`. The same preflight shape, the same 402/409/429/503 refusals and the same `{ jobId, estimatedCost, upload }`; the audio is uploaded and the job started through the endpoints below, because it is the same resource.
- `POST /v1/jobs/:id/upload/complete` (token): `{ parts: [{ partNumber, etag }] }`. `POST /v1/jobs/:id/start` (token): moves to `validating` and returns immediately (see Section 1, A5).
- `GET /v1/jobs/:id` (token): `{ status, stage, progress, kind, framesDone, totalFrames, audioSeconds?, audioSecondsDone?, reserved, consumed, etaSeconds, cost, charge?, refund?, downloadUrl?, error? }`. `downloadUrl` points at the upscaled video for an `upscale` job and at the transcript JSON for a `transcribe` one.
- `DELETE /v1/jobs/:id` (token): cancel, applying Section 0.3. Returns `{ status: 'canceling' | 'canceled' }`.
- Internal (worker, HMAC with a per-job secret): `POST /internal/jobs/:id/heartbeat`, `.../probe-result`, `.../complete`. Operator only: `POST /internal/reap` (shared secret).

## 0.7 Worker protocol (API to worker, HTTP)

All requests carry `X-Signature` (HMAC-SHA256 of the body with `WORKER_SECRET`) and a timestamp, and the worker rejects stale ones.

- `POST /v1/probe`: `{ jobId, inputUrl, callbackBase, callbackSecret, mode? }`, where `mode` is `video` (default) or `audio`. A cheap CPU container runs ffprobe on the downloaded or range-read file and posts `{ width, height, fps, durationSec, totalFrames, codec, hasAudio, sizeBytes, ok, reason? }` to `probe-result`. In **audio** mode an audio-only MP4/M4A is valid, the video checks do not apply, and the probe reports `audioSeconds` — what a transcription is priced from — instead of `totalFrames`. In video mode, reject files that are not a plain MP4 or MOV container with H.264 or HEVC, or that exceed limits. Allow no network protocols besides the one HTTPS input URL.
- `POST /v1/run`: `{ jobId, inputUrl, outputPutUrl (or multipart URLs), params: { srcW, srcH, fps, totalFrames, targetW, targetH, model, scale, codec, crf }, callbackBase, callbackSecret, limits }` returns `{ runId }`.
- `POST /v1/transcribe`: `{ jobId, inputUrl, outputPutUrl (or multipart URLs), params: { model, language, wordTimestamps }, callbackBase, callbackSecret, limits: { maxAudioSeconds, maxSizeBytes } }` returns the same `{ runId }` and reports through the same callbacks, so the API has one job lifecycle rather than two. The result is a **transcript JSON** PUT to `outputPutUrl`: `{ version, language, model, durationSec, segments: [{ start, end, text, words?: [{ start, end, text }] }] }`, with `start`/`end` in seconds into the uploaded audio. No styling, no line breaks and no speaker labels — those belong to the app, and freezing them here would mean a contract change per caption preset.
- `POST /v1/cancel`: `{ runId }`. Best effort.
- Worker to API: heartbeat `{ stage, framesDone, fpsRecent }` for an upscale or `{ stage, audioSecondsDone, fpsRecent }` for a transcription — exactly one counter, the one the job's kind bills from — whose response is `{ cancel: boolean }`, and a final `complete` `{ outcome: 'succeeded' | 'failed' | 'canceled', framesDone, audioSecondsDone, outputBytes, errorCode?, errorClass: 'input' | 'infra', metrics }` where the counter that does not apply is `null`.

## 0.8 Security rules (all repos)

- Secrets only in environment variables or the platform's secret store. Never in code, logs or client bundles.
- The server never trusts client-reported numbers for price. Price comes from the worker probe.
- Presigned URLs are per job, short-lived (1 hour upload, 24 hours download), scoped to one object key. The worker never receives storage credentials. The audio a transcription is handed is presigned the same way, and the transcript is written to a presigned PUT like any other result.
- Raw license keys are never stored in plain text (hash for lookup, encrypted copy only until delivered once).
- Credit amounts for purchases come from a server-side `PRODUCTS` table keyed by Dodo product ID, never from request or metadata values.
- Retention: uploads and results are deleted 24 hours after completion (R2 lifecycle rule plus Mongo TTL). Log job IDs, never file contents or full URLs.
