import { describe, expect, it } from 'vitest'
import {
  CLOUD_WORK_STAGES,
  cloudStagePercent,
  isBeforeGpuWork,
  projectCancellation,
  stageFromJobStatus,
  stageStep,
} from './cloud-stages'

describe('stageStep', () => {
  it('numbers the six stages the user waits through', () => {
    expect(CLOUD_WORK_STAGES).toHaveLength(6)
    expect(stageStep('Rendering locally')).toEqual({ index: 1, total: 6 })
    expect(stageStep('Validating')).toEqual({ index: 3, total: 6 })
    expect(stageStep('Downloading')).toEqual({ index: 6, total: 6 })
  })

  it('treats the terminal stage as the last step', () => {
    expect(stageStep('Done')).toEqual({ index: 6, total: 6 })
  })
})

describe('cloudStagePercent', () => {
  it('maps each stage onto its own slice of the overall bar', () => {
    expect(cloudStagePercent('Rendering locally', 0)).toBe(0)
    expect(cloudStagePercent('Rendering locally', 100)).toBe(40)
    expect(cloudStagePercent('Uploading', 50)).toBe(45)
    expect(cloudStagePercent('Upscaling', 100)).toBe(92)
    expect(cloudStagePercent('Downloading', 100)).toBe(100)
  })

  it('never leaves the bar or goes backwards for nonsense input', () => {
    expect(cloudStagePercent('Upscaling', -10)).toBe(60)
    expect(cloudStagePercent('Upscaling', 1000)).toBe(92)
    expect(cloudStagePercent('Validating', Number.NaN)).toBe(50)
  })
})

describe('stageFromJobStatus', () => {
  it('maps the contract statuses onto the UI stages', () => {
    expect(stageFromJobStatus('uploading')).toBe('Uploading')
    expect(stageFromJobStatus('uploaded')).toBe('Uploading')
    expect(stageFromJobStatus('validating')).toBe('Validating')
    expect(stageFromJobStatus('queued')).toBe('Waiting for GPU')
    expect(stageFromJobStatus('running')).toBe('Upscaling')
  })

  it('has no stage for terminal statuses, which have their own dialogs', () => {
    expect(stageFromJobStatus('rejected')).toBeNull()
    expect(stageFromJobStatus('failed')).toBeNull()
    expect(stageFromJobStatus('expired')).toBeNull()
  })
})

describe('isBeforeGpuWork', () => {
  it('is true until the GPU starts', () => {
    for (const stage of CLOUD_WORK_STAGES.slice(0, 4)) expect(isBeforeGpuWork(stage)).toBe(true)
  })

  it('is false once the GPU is upscaling or the result is downloading', () => {
    expect(isBeforeGpuWork('Upscaling')).toBe(false)
    expect(isBeforeGpuWork('Downloading')).toBe(false)
  })
})

describe('projectCancellation', () => {
  it('costs nothing before the GPU starts', () => {
    const projection = projectCancellation({
      stage: 'Uploading',
      reserved: 1200,
      consumed: 0,
      minChargeCredits: 10,
      cost: 1200,
    })
    expect(projection.free).toBe(true)
    expect(projection.charged).toBe(0)
    expect(projection.returned).toBe(1200)
    expect(projection.body).toMatch(/No credits have been used/)
  })

  it('charges the work done once the GPU is running, and returns the rest', () => {
    const projection = projectCancellation({
      stage: 'Upscaling',
      reserved: 1200,
      consumed: 408,
      minChargeCredits: 10,
      cost: 1200,
    })
    expect(projection.free).toBe(false)
    expect(projection.charged).toBe(408)
    expect(projection.returned).toBe(792)
    expect(projection.body).toMatch(/charged for that work/)
  })

  it('applies the minimum charge to a start-and-cancel', () => {
    const projection = projectCancellation({
      stage: 'Upscaling',
      reserved: 1200,
      consumed: 4,
      minChargeCredits: 10,
      cost: 1200,
    })
    expect(projection.charged).toBe(10)
    expect(projection.returned).toBe(1190)
  })

  it('never charges more than the job costs', () => {
    const projection = projectCancellation({
      stage: 'Upscaling',
      reserved: 1200,
      consumed: 9999,
      minChargeCredits: 10,
      cost: 1200,
    })
    expect(projection.charged).toBe(1200)
    expect(projection.returned).toBe(0)
  })

  it('never returns a negative amount', () => {
    const projection = projectCancellation({
      stage: 'Upscaling',
      reserved: 0,
      consumed: 50,
      minChargeCredits: 10,
      cost: 100,
    })
    expect(projection.returned).toBe(0)
  })
})
