# Cloud upscaling API (v1)

Contract for the AI (cloud) upscale used by the DemoThat export modal. The client
is implemented in this repo (`electron/main/features/cloud-upscale-client.ts`);
the server is **not** — `scripts/mock-upscale-server.mjs` implements this
contract so the client can be developed and tested without a backend.

The `.dthat` project file is never part of this flow. The server only ever sees a
rendered video.

## Transport, auth, retention

- All requests are `https://` in production (the mock runs on plain HTTP on
  localhost). TLS is terminated by the server; the client uses Node's default CA
  store and does not disable verification.
- Auth: `Authorization: Bearer <token>`. The token and the base URL come from
  `electron-store` (`cloud.baseUrl`, `cloud.token`), never from constants.
- Uploads and results use **short-lived presigned URLs** (the `uploadUrl` and
  `downloadUrl` in the responses). They are usable without the bearer token and
  expire, so a leaked URL is not a lasting credential. Default TTL: 1 hour.
- Retention: uploads and results are deleted after download, or within **24
  hours**, whichever comes first. Nothing is kept beyond the job record summary.
- Limits (advertised in `capabilities.limits`, enforced server-side):
  `maxFileSizeBytes`, `maxDurationSec`, `maxOutputMegapixels`, `maxConcurrentJobs`.

## Pricing and credits

The server **ffprobes the uploaded file itself** and computes the price from the
real dimensions, duration and frame rate. Client-reported numbers in
`POST /v1/jobs` are advisory hints only — they are what the client knew before
the render/upload finished, and they are never used for billing.

- Credits are **reserved at job creation** and **settled only on success** (the
  charge is `ceil(outputMegapixels * frames * pricing.creditsPerOutputMegapixelFrame)`,
  computed from the probed source and the requested target).
- `DELETE /v1/jobs/:id` cancels the job and releases the reservation.
- A failed job releases the reservation; a cancelled or expired job releases it.
- `402 insufficient_credits` means the current balance cannot cover the requested
  job. The client must surface this **before rendering anything**.

## Endpoints

### `GET /v1/capabilities`

```json
{
  "apiVersion": "1",
  "models": [
    { "id": "realesr-animevideov3", "label": "Anime/Video 3x", "scales": [2, 3, 4] },
    { "id": "realesrgan-plus", "label": "Real-ESRGAN+", "scales": [4] }
  ],
  "defaultModel": "realesr-animevideov3",
  "targets": [ { "key": "4k", "width": 3840, "height": 2160 }, { "key": "8k", "width": 7680, "height": 4320 } ],
  "upscaleFps": { "720p": 30, "1080p": 18, "2k": 12, "4k": 7, "8k": 2.5 },
  "startupSeconds": 25,
  "pricing": { "creditsPerOutputMegapixelFrame": 0.0004, "currency": "credits" },
  "credits": 480,
  "limits": {
    "maxFileSizeBytes": 2147483648,
    "maxDurationSec": 3600,
    "maxOutputMegapixels": 33.2,
    "maxConcurrentJobs": 2
  }
}
```

`upscaleFps` is measured per target size; the client uses it for its estimate and
never invents a number of its own. `credits` is the account balance.

### `POST /v1/jobs`

```json
{
  "sourceWidth": 3840, "sourceHeight": 2160,
  "fps": 30, "durationSec": 12.5, "fileSizeBytes": 48213332,
  "targetWidth": 7680, "targetHeight": 4320,
  "model": "realesr-animevideov3"
}
```

`201` on success:

```json
{
  "jobId": "job_8f14e45f",
  "status": "awaiting_upload",
  "uploadUrl": "https://…/v1/uploads/job_8f14e45f?expires=1699999999&sig=…",
  "uploadExpiresAt": "2026-10-15T13:00:00.000Z",
  "creditsReserved": 36,
  "plan": { "model": "realesr-animevideov3", "modelScale": 2, "finalScale": "7680:4320" }
}
```

Errors: `400`/`422 invalid_request`, `401 unauthorized`,
`402 insufficient_credits` (`{ "error": { "code": "insufficient_credits", "message": …, "required": 36, "available": 12 } }`),
`413 too_large`, `429 rate_limited`.

`plan` is advisory — the server re-derives it from the probe once the upload
lands, and the client re-derives its own copy with `shared/upscale-plan.ts` for
display.

### `PUT <uploadUrl>`

Raw body: the intermediate video bytes. `Content-Type: video/mp4`,
`Content-Length` required. Streamed; the server never buffers the whole file.
`204` on success. The client streams from disk and reports progress from the
bytes it has written.

### `GET /v1/jobs/:id`

```json
{
  "jobId": "job_8f14e45f",
  "status": "upscaling",
  "progress": 42.5,
  "etaSeconds": 96,
  "downloadUrl": null,
  "creditsReserved": 36,
  "creditsCharged": null,
  "source": { "width": 3840, "height": 2160, "fps": 30, "durationSec": 12.5 },
  "result": null
}
```

- `status`: `awaiting_upload` → `queued` → `upscaling` → `ready` | `failed` |
  `cancelled` | `expired`.
- When `ready`: `downloadUrl` (presigned, short-lived) and
  `result: { width, height, fileSizeBytes, codec: "hevc", creditsCharged }`.
- `progress` is 0–100 for the upscale stage only (upload progress is the client's
  own, from the bytes it sends). `etaSeconds` may be `null` while unknown.
- `failed` carries `error: { code, message }`.

The client polls this with backoff and may repeat a request after a network
failure.

### `GET <downloadUrl>`

The result file. `200` with `Content-Type: video/mp4` and `Content-Length`.
The server deletes the result once it has been downloaded (or after 24 hours).

### `DELETE /v1/jobs/:id`

Cancels the job, kills any running worker and releases the credit reservation.
`200 { "jobId": …, "status": "cancelled" }`; idempotent (`404` if never existed).

## Scale planning (both sides)

`need = max(targetW / srcW, targetH / srcH)`. Pick the smallest model factor that
is at least `need` — allowing a 1 % shortfall, since a fraction of a percent is
better served by the final Lanczos pass than by running the model on far more
pixels. If no factor is big enough, use the largest and let Lanczos finish the
remaining factor. Then scale to the exact target with `flags=lanczos`.

| source | target | need | model | model output | final |
| --- | --- | --- | --- | --- | --- |
| 1080p | 8K | 4 | 4x | 7680×4320 | none |
| 1440p | 8K | 3 | 3x | 7680×4320 | none |
| 720p | 8K | 6 | 4x | 5120×2880 | Lanczos **up** to 7680×4320 |
| 4K | 8K | 2 | 2x | 7680×4320 | none |
| 1080p | 4K | 2 | 2x | 3840×2160 | none |

(Note: the 720p→8K row is an upscale after the model, not a downscale — 4× of
720p is below 8K. See the phase report.)

The shared implementation is `shared/upscale-plan.ts`; the server must re-derive
this from the probe rather than trusting the client's `plan`.

## Worker environment (reference)

Per the owner's Video2X notebook (a **reference only** — it is interactive, tied
to Google Drive and subject to session limits; do not automate Colab):

- Video2X **6.2.0**, Linux package (AGPL-3.0 — verified before any bundling
  decision; the desktop app must not bundle it in this work).
- Vulkan libraries plus a current NVIDIA driver for GPU inference.
- FFmpeg 7 on the worker, used for the probe, the final Lanczos scale and the
  encode.
- Models: `realesr-animevideov3` (2x/3x/4x — the default for screen recordings,
  which are mostly flat UI and text) or `realesrgan-plus` (4x only). Others are
  advertised through `capabilities.models`.
- Final encode: HEVC via **NVENC** (`hevc_nvenc`), `-tag:v hvc1`, `-pix_fmt
  yuv420p`; audio is copied from the intermediate (`-c:a copy`) since the client
  already muxed it.

The worker probes the upload, runs the model at the planned factor, applies the
final `scale=…:flags=lanczos`, encodes HEVC and writes the result. It never sees
the project file, the editor state or the user's filesystem.

## Mock server

```bash
node scripts/mock-upscale-server.mjs            # http://127.0.0.1:8787
```

| env | default | meaning |
| --- | --- | --- |
| `MOCK_PORT` | `8787` | listen port |
| `MOCK_TOKEN` | `dev-token` | expected bearer token |
| `MOCK_CREDITS` | `500` | starting balance; `0` forces `insufficient_credits` |
| `MOCK_STARTUP_MS` | `1500` | simulated worker startup |
| `MOCK_FFMPEG` | `binaries/linux/ffmpeg` | binary used for probe + "upscale" |
| `MOCK_FAIL_UPSCALE` | – | set to fail the upscale stage |

The mock probes with the bundled `ffmpeg -i` (stderr parsing — this repo ships no
`ffprobe`) and performs the upscale with FFmpeg's Lanczos + HEVC, standing in for
Video2X/Real-ESRGAN, which needs a Vulkan GPU this environment does not have.
Everything else — the endpoints, the credit reservation and settlement, the
presigned URL shape, the retention sweep and the error codes — behaves as this
document describes, so the client is tested against the real contract.
