// Cloud export stages, progress and cancel copy.
//
// Shared by the main process (which drives the stages) and the renderer (which
// draws the progress and cancel dialogs), so the two cannot disagree about what
// a stage is called, how far along it is, or what cancelling costs.

export type CloudStage =
  'Rendering locally' | 'Uploading' | 'Validating' | 'Waiting for GPU' | 'Upscaling' | 'Downloading' | 'Done'

/** The stages the user waits through; `Done` is the terminal state. */
export const CLOUD_WORK_STAGES: CloudStage[] = [
  'Rendering locally',
  'Uploading',
  'Validating',
  'Waiting for GPU',
  'Upscaling',
  'Downloading',
]

/** "Step N of 6" for the progress dialog (design reference §6). */
export function stageStep(stage: CloudStage): { index: number; total: number } {
  const index = CLOUD_WORK_STAGES.indexOf(stage)
  return { index: index === -1 ? CLOUD_WORK_STAGES.length : index + 1, total: CLOUD_WORK_STAGES.length }
}

/**
 * Share of the overall bar each stage owns. The local render is the longest
 * local stage, the GPU's own progress is what the user waits on, and the
 * download is nearly always short.
 */
const STAGE_WEIGHTS: Record<CloudStage, { from: number; to: number }> = {
  'Rendering locally': { from: 0, to: 40 },
  Uploading: { from: 40, to: 50 },
  Validating: { from: 50, to: 55 },
  'Waiting for GPU': { from: 55, to: 60 },
  Upscaling: { from: 60, to: 92 },
  Downloading: { from: 92, to: 100 },
  Done: { from: 100, to: 100 },
}

/** Maps a stage's own 0-100 progress onto the overall 0-100 bar. */
export function cloudStagePercent(stage: CloudStage, stagePercent: number): number {
  const { from, to } = STAGE_WEIGHTS[stage]
  const clamped = Math.max(0, Math.min(100, Number.isFinite(stagePercent) ? stagePercent : 0))
  return Math.round(from + ((to - from) * clamped) / 100)
}

/** The UI stage a job status corresponds to. Null for terminal statuses. */
export function stageFromJobStatus(status: string): CloudStage | null {
  switch (status) {
    case 'created':
    case 'uploading':
    case 'uploaded':
      return 'Uploading'
    case 'validating':
      return 'Validating'
    case 'queued':
      return 'Waiting for GPU'
    case 'running':
    case 'canceling':
      return 'Upscaling'
    case 'canceled':
    case 'succeeded':
      return 'Downloading'
    default:
      // rejected / failed / expired have their own dialogs.
      return null
  }
}

/** True while cancelling costs nothing, because no GPU work has begun (§0.3). */
export function isBeforeGpuWork(stage: CloudStage): boolean {
  return stage === 'Rendering locally' || stage === 'Uploading' || stage === 'Validating' || stage === 'Waiting for GPU'
}

export interface CancelProjectionInput {
  stage: CloudStage
  /** Reserved at job creation (server value). */
  reserved: number
  /** The server's used-so-far number from the latest poll. */
  consumed: number
  /** The server's minimum charge once GPU work has begun. */
  minChargeCredits: number
  /** The server's cost for the whole job. */
  cost: number
}

/** What the Cancel dialog shows before the user confirms. */
export interface CancelProjection {
  /** True when nothing has been reserved or charged yet. */
  free: boolean
  /** Projected charge, always labelled "about" in the UI. */
  charged: number
  returned: number
  /** The one-line explanation (design §7). */
  body: string
}

/**
 * The cancel dialog's numbers, from server values only: `consumed` comes from
 * the latest poll, `reserved`/`cost`/`minChargeCredits` from the job and the
 * capabilities. The settled charge still comes back from the API.
 */
export function projectCancellation(input: CancelProjectionInput): CancelProjection {
  if (isBeforeGpuWork(input.stage)) {
    return {
      free: true,
      charged: 0,
      returned: input.reserved,
      body: 'No credits have been used. You can export again any time.',
    }
  }
  const consumed = Math.max(0, Math.min(input.cost, input.consumed))
  const charged = Math.min(input.cost, Math.max(input.minChargeCredits, consumed))
  return {
    free: false,
    charged,
    returned: Math.max(0, input.reserved - charged),
    body:
      "The GPU has already processed part of your video. You'll be charged for that work and the rest is " +
      'returned. No video is saved.',
  }
}
