// Instant publishing: put a rendered video behind a share link, a landing page or an
// embed, and read back who watched it.
//
// The shape is deliberately the same as `cloud-export.ts` and `transcribe.ts` —
// create, upload, complete — because it is the same kind of work: reserve a slot,
// push bytes to the object store, and let the server price it. What differs is that
// there is nothing to poll and nothing to download, so this module has no job
// lifecycle. The completion call *is* the activation: it is where the server reads the
// real size back from the store, charges the balance and starts the clock on the term.
//
// Two things this module must not do:
//
// **It must not decide the price.** `estimatePublishCredits` (shared/publish-cost.ts)
// mirrors the server so the dialog can quote a number, but the number that is charged
// comes back from `complete()` and only from there. The upload plan the server returns
// is used as-is.
//
// **It must not treat a failed upload as a lost publication.** A publication that was
// created but never completed is uncharged and invisible; the honest response is to
// retry or to abandon it, never to pretend it exists. `publish()` therefore cleans up
// what it created when it gives up, so the user's Shared links list cannot fill up
// with entries that were never real.

import fsp from 'node:fs/promises'
import log from 'electron-log/main'
import type { components } from '../../../shared/api-types'
import { apiRequest } from '../lib/api-client'
import { getApiBaseUrl } from '../lib/api-config'
import { normalizeCues, toVtt, type SubtitleCue } from '../../../shared/subtitles'
import {
  asCloudError,
  requireToken,
  uploadIntermediate,
  CloudError,
  type CloudCancellation,
  type CloudUploadPlan,
} from './cloud-client'

export type PublicationView = components['schemas']['PublicationView']
export type PublicationList = components['schemas']['PublicationList']
export type PublicationLinks = components['schemas']['PublicationLinks']
export type PublicationAnalytics = components['schemas']['PublicationAnalytics']
export type PublicationKind = components['schemas']['PublicationKind']
export type PublicationStatus = components['schemas']['PublicationStatus']
export type PublicationAnalyticsRange = '7d' | '30d' | '90d' | 'all'
export type CreatePublicationResponse = components['schemas']['CreatePublicationResponse']

/** The server's cap on an inline caption track, in bytes. */
export const MAX_CAPTIONS_BYTES = 2_000_000

// --- Endpoints -----------------------------------------------------------------

export interface CreatePublicationInput {
  kind: PublicationKind
  fileSizeBytes: number
  storageDays: number
  title?: string
  durationSec?: number
  captionLanguage?: string
}

/**
 * `POST /v1/publications` — a preflight and an upload plan. Charges nothing.
 *
 * The declared `fileSizeBytes` is a preflight only; the server re-prices from the size
 * it reads back at completion, and that number is final.
 */
export async function createPublication(input: CreatePublicationInput): Promise<CreatePublicationResponse> {
  try {
    return await apiRequest<CreatePublicationResponse>(getApiBaseUrl(), {
      method: 'POST',
      path: '/v1/publications',
      body: input,
      token: requireToken(),
      retries: 1,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

/**
 * `POST /v1/publications/:id/upload/complete` — HEAD the object, charge, activate.
 *
 * The caption track travels in this request body rather than as its own upload: the
 * player fetches `<track>` from our origin, so the track has to be readable
 * same-origin, and the server stores it as text on the publication.
 */
export async function completePublicationUpload(
  publicationId: string,
  parts: Array<{ partNumber: number; etag: string }>,
  captionsVtt?: string,
): Promise<PublicationView> {
  try {
    return await apiRequest<PublicationView>(getApiBaseUrl(), {
      method: 'POST',
      path: `/v1/publications/${encodeURIComponent(publicationId)}/upload/complete`,
      body: { parts, ...(captionsVtt !== undefined ? { captionsVtt } : {}) },
      token: requireToken(),
      retries: 1,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

/** `GET /v1/publications` — everything this license has published, newest first. */
export async function listPublications(): Promise<PublicationView[]> {
  try {
    const result = await apiRequest<PublicationList>(getApiBaseUrl(), {
      method: 'GET',
      path: '/v1/publications',
      token: requireToken(),
      retries: 2,
    })
    return result.publications ?? []
  } catch (error) {
    throw asCloudError(error)
  }
}

/** `GET /v1/publications/:id` — one publication's current state. */
export async function fetchPublication(publicationId: string): Promise<PublicationView> {
  try {
    return await apiRequest<PublicationView>(getApiBaseUrl(), {
      method: 'GET',
      path: `/v1/publications/${encodeURIComponent(publicationId)}`,
      token: requireToken(),
      retries: 2,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

export interface DeletePublicationResult {
  view: PublicationView
  /** Always 0, and the server says so explicitly so the UI never implies otherwise. */
  creditsRefunded: number
}

/**
 * `DELETE /v1/publications/:id` — bytes gone immediately, credits not returned.
 *
 * The link stops working at once because the video URL is minted per request and is
 * only minted for a servable publication. The charge stands: the term was bought when
 * the publication was activated, and refunding it would make publish-then-delete a way
 * to keep a link alive for free.
 */
export async function deletePublication(publicationId: string): Promise<DeletePublicationResult> {
  try {
    const view = await apiRequest<PublicationView>(getApiBaseUrl(), {
      method: 'DELETE',
      path: `/v1/publications/${encodeURIComponent(publicationId)}`,
      token: requireToken(),
      retries: 1,
    })
    return { view, creditsRefunded: 0 }
  } catch (error) {
    throw asCloudError(error)
  }
}

/** `GET /v1/publications/:id/analytics` — who watched, from where, for how long. */
export async function fetchPublicationAnalytics(
  publicationId: string,
  range: PublicationAnalyticsRange = '30d',
): Promise<PublicationAnalytics> {
  try {
    return await apiRequest<PublicationAnalytics>(getApiBaseUrl(), {
      method: 'GET',
      path: `/v1/publications/${encodeURIComponent(publicationId)}/analytics?range=${range}`,
      token: requireToken(),
      retries: 2,
    })
  } catch (error) {
    throw asCloudError(error)
  }
}

// --- The orchestrator ----------------------------------------------------------

export type PublishStage = 'Preparing' | 'Uploading' | 'Activating' | 'Done'

export interface PublishProgress {
  stage: PublishStage
  /** 0-100 within the current stage. */
  stagePercent: number
  /** The server's quote from the declared size, once it has been created. */
  estimatedCost?: number
}

export interface PublishRequest {
  /** The rendered video to publish. */
  filePath: string
  kind: PublicationKind
  storageDays: number
  title?: string
  durationSec?: number
  /** The project's cues. Converted to VTT here so nothing else has to. */
  captions?: SubtitleCue[]
  cancel: CloudCancellation
  onProgress: (progress: PublishProgress) => void
}

export type PublishResult =
  | { ok: true; publication: PublicationView; captionsIncluded: boolean }
  | {
      ok: false
      reason: 'canceled' | 'rejected' | 'failed'
      error: string
      /** The server's quote, when it refused for credits. */
      cost?: number
      balance?: number
    }

/**
 * Build the WebVTT track the completion call carries, or `null` when there is nothing
 * to send.
 *
 * Normalised first, so the app and the export sidecar cannot disagree about where a
 * line breaks. Cues are expected in export time, which is what the caption track is
 * timed against.
 */
export function captionsForPublication(cues: SubtitleCue[] | undefined): string | null {
  if (cues === undefined || cues.length === 0) return null
  const vtt = toVtt(normalizeCues(cues))
  if (Buffer.byteLength(vtt, 'utf8') > MAX_CAPTIONS_BYTES) {
    throw new CloudError('These captions are too long to publish with the video.', 'captions_too_large')
  }
  return vtt
}

/**
 * Publish a rendered video: create, upload, complete.
 *
 * Nothing here charges on its own — the completion call is where the server HEADs the
 * object and takes the credits, so an upload that dies halfway leaves the user with
 * exactly the balance they started with.
 */
export async function publish(request: PublishRequest): Promise<PublishResult> {
  const { filePath, cancel, onProgress } = request
  let publicationId: string | null = null
  let kind: PublicationKind = request.kind

  /** Get rid of what we created; a publication that never activated is not real. */
  const abandon = async (): Promise<void> => {
    if (publicationId === null) return
    try {
      await deletePublication(publicationId)
      log.info(`[Publishing] Abandoned uncharged publication ${publicationId}`)
    } catch (error) {
      // Nothing was charged either way; the server's abandoned-upload sweep will take
      // the object. Losing the cleanup is not worth failing the whole operation over.
      log.warn('[Publishing] Could not clean up an unfinished publication:', error)
    }
  }

  try {
    const { size } = await fsp.stat(filePath)
    const captionsVtt = captionsForPublication(request.captions)

    // --- Create ---------------------------------------------------------------
    onProgress({ stage: 'Preparing', stagePercent: 0 })
    const created = await createPublication({
      kind: request.kind,
      fileSizeBytes: size,
      storageDays: request.storageDays,
      ...(request.title !== undefined && request.title.trim().length > 0 ? { title: request.title.trim() } : {}),
      ...(request.durationSec !== undefined ? { durationSec: request.durationSec } : {}),
    })
    publicationId = created.publicationId
    kind = request.kind
    onProgress({ stage: 'Preparing', stagePercent: 100, estimatedCost: created.estimatedCost })

    // --- Upload ---------------------------------------------------------------
    onProgress({ stage: 'Uploading', stagePercent: 0, estimatedCost: created.estimatedCost })
    const uploaded = await uploadIntermediate(created.upload as CloudUploadPlan, filePath, {
      cancel,
      onProgress: (percent) =>
        onProgress({ stage: 'Uploading', stagePercent: percent, estimatedCost: created.estimatedCost }),
    })
    onProgress({ stage: 'Uploading', stagePercent: 100, estimatedCost: created.estimatedCost })

    // --- Activate -------------------------------------------------------------
    // The charge happens in here. Saying "Activating" rather than "Finishing" matters:
    // this is the step the user is paying for, and it is where a size-based price may
    // differ from the quote.
    onProgress({ stage: 'Activating', stagePercent: 0, estimatedCost: created.estimatedCost })
    const publication = await completePublicationUpload(created.publicationId, uploaded.parts, captionsVtt ?? undefined)
    publicationId = null // activated: nothing to abandon
    onProgress({ stage: 'Done', stagePercent: 100 })

    return { ok: true, publication, captionsIncluded: captionsVtt !== null }
  } catch (error) {
    const cloudError = error instanceof CloudError ? error : new CloudError(String(error), 'unknown')

    if (cloudError.code === 'cancelled') {
      await abandon()
      return { ok: false, reason: 'canceled', error: 'Publishing was cancelled. You were not charged.' }
    }

    // A refusal before any bytes moved: the balance could not cover the quote.
    if (cloudError.code === 'insufficient_credits') {
      const details = cloudError.details as { estimatedCost?: number; balance?: number } | undefined
      return {
        ok: false,
        reason: 'rejected',
        error: 'There are not enough credits to publish this with that term.',
        ...(details?.estimatedCost !== undefined ? { cost: details.estimatedCost } : {}),
        ...(details?.balance !== undefined ? { balance: details.balance } : {}),
      }
    }

    // A refusal the user can act on without support: the file itself is the problem.
    if (cloudError.status === 400 || cloudError.status === 413) {
      await abandon()
      return { ok: false, reason: 'rejected', error: cloudError.message }
    }

    // The completion failing is its own case: the server may have refused the charge
    // or the caption track, and it has already deleted the object when it did.
    if (publicationId !== null && cloudError.status === 402) {
      await abandon()
      return {
        ok: false,
        reason: 'rejected',
        error: 'The video turned out to cost more credits than the balance covers, so it was not published.',
      }
    }

    log.error(`[Publishing] Failed (${kind}):`, cloudError.message)
    await abandon()
    return { ok: false, reason: 'failed', error: cloudError.message }
  }
}
