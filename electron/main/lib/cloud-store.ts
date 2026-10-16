// Persisted cloud-export state: the active job, the upload resume record and the
// consent decision.
//
// None of this is secret (a job id, part etags, a boolean), so it lives in
// electron-store rather than the encrypted credential store. Every accessor is
// lazily created so importing this module has no side effects in tests.

import Store from 'electron-store'
import log from 'electron-log/main'
import type { UploadResume } from '../features/cloud-client'

export interface ActiveJobRecord {
  jobId: string
  outputPath: string
  intermediatePath: string
  targetWidth: number
  targetHeight: number
  /** Epoch ms, so a stale record can be recognised. */
  startedAt: number
}

const ACTIVE_JOB_KEY = 'cloud.activeJob'
const UPLOADS_KEY = 'cloud.uploads'
const CONSENT_KEY = 'cloud.consentAcceptedV1'

let cachedStore: Store<Record<string, unknown>> | null = null

function store(): Store<Record<string, unknown>> {
  if (!cachedStore) {
    cachedStore = new Store<Record<string, unknown>>(
      process.env.ELECTRON_STORE_NAME ? { name: process.env.ELECTRON_STORE_NAME } : { name: 'config' },
    )
  }
  return cachedStore
}

// --- Active job ---------------------------------------------------------------

export function saveActiveJob(record: ActiveJobRecord): void {
  store().set(ACTIVE_JOB_KEY, record)
}

export function clearActiveJob(): void {
  store().delete(ACTIVE_JOB_KEY)
}

export function getActiveJob(): ActiveJobRecord | null {
  const value = store().get(ACTIVE_JOB_KEY)
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ActiveJobRecord>
  if (typeof record.jobId !== 'string' || typeof record.outputPath !== 'string') return null
  return {
    jobId: record.jobId,
    outputPath: record.outputPath,
    intermediatePath: typeof record.intermediatePath === 'string' ? record.intermediatePath : '',
    targetWidth: typeof record.targetWidth === 'number' ? record.targetWidth : 0,
    targetHeight: typeof record.targetHeight === 'number' ? record.targetHeight : 0,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : 0,
  }
}

// --- Upload resume ------------------------------------------------------------

function uploads(): Record<string, UploadResume> {
  const value = store().get(UPLOADS_KEY)
  return value && typeof value === 'object' ? (value as Record<string, UploadResume>) : {}
}

export function saveUploadResume(jobId: string, resume: UploadResume): void {
  try {
    store().set(UPLOADS_KEY, { ...uploads(), [jobId]: resume })
  } catch (error) {
    // Losing the resume record only costs re-uploading parts.
    log.warn(`[CloudStore] Could not persist the upload resume for ${jobId}: ${(error as Error).message}`)
  }
}

export function getUploadResume(jobId: string): UploadResume | null {
  const record = uploads()[jobId]
  if (!record || !Array.isArray(record.parts)) return null
  return { uploadId: typeof record.uploadId === 'string' ? record.uploadId : null, parts: record.parts }
}

export function clearUploadResume(jobId: string): void {
  const all = uploads()
  if (!(jobId in all)) return
  delete all[jobId]
  store().set(UPLOADS_KEY, all)
}

// --- Consent ------------------------------------------------------------------

export function hasCloudConsent(): boolean {
  return store().get(CONSENT_KEY) === true
}

export function recordCloudConsent(accepted: boolean): void {
  if (accepted) store().set(CONSENT_KEY, true)
  else store().delete(CONSENT_KEY)
}
