// Cloud export progress (design reference §6).
//
// Stage, overall bar, ETA and the credits meter: what has been used out of what
// is held. The numbers come from the server's job view.

import { Loader2 } from 'tabler-icons-react'
import { formatCredits } from '../../../../shared/license'
import { stageStep, type CloudStage } from '../../../../shared/cloud-stages'
import { Button } from '../../ui/button'
import { ICON_STROKE } from '../../ui/icons'
import { etaLabel } from './cloud-copy'

export interface CloudExportProgressProps {
  stage: CloudStage
  /** Overall 0-100 across all stages. */
  percent: number
  framesDone?: number
  totalFrames?: number
  reserved?: number
  consumed?: number
  etaSeconds?: number | null
  onCancel: () => void
}

export function CloudExportProgress({
  stage,
  percent,
  reserved,
  consumed,
  etaSeconds,
  onCancel,
}: CloudExportProgressProps) {
  const step = stageStep(stage)
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const eta = etaLabel(etaSeconds)
  const showCredits = typeof reserved === 'number' && reserved > 0

  return (
    <div className="flex flex-col items-center px-8 py-8 text-center">
      <Loader2 size={28} strokeWidth={ICON_STROKE} className="animate-spin text-muted" />
      <h3 className="mt-4 text-title font-semibold text-fg">Upscaling in the cloud</h3>
      <p className="mt-0.5 text-sm text-muted">
        Step {step.index} of {step.total} · {stage}
      </p>

      <div className="mt-6 h-1.5 w-full overflow-hidden rounded-seg bg-ctl" role="progressbar" aria-valuenow={clamped}>
        <i
          className="block h-full bg-accent transition-[width] duration-[400ms] ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>

      <p className="mt-3 whitespace-nowrap font-mono text-sm tabular-nums text-fg">
        {clamped}%{eta ? ` · ${eta}` : ''}
      </p>

      {showCredits && (
        <p className="whitespace-nowrap font-mono text-sm tabular-nums text-muted">
          {formatCredits(consumed ?? 0)} of {formatCredits(reserved!)} credits used
        </p>
      )}

      <p className="mt-3 text-sm text-muted">Unused credits are returned if you cancel.</p>

      <div className="mt-6 w-full">
        <Button variant="secondary" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
