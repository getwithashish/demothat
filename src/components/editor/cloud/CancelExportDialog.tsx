// Cancel an export, with text that depends on the stage (design reference §7, spec §0.3).
//
// Before the GPU starts, cancelling is free. Once it is upscaling, the work done
// is charged and the rest returned — the figures shown are the server's
// `consumed`/`reserved` (and the capabilities' minimum charge); the settled
// charge is always the one the API returns afterwards.

import { formatCredits } from '../../../../shared/license'
import { projectCancellation, type CloudStage } from '../../../../shared/cloud-stages'
import { Button } from '../../ui/button'
import { CloudDialog, CloudDialogSection } from './CloudDialog'

export interface CancelExportDialogProps {
  isOpen: boolean
  stage: CloudStage
  /** Server's reserved credits for this job. */
  reserved: number
  /** Server's used-so-far credits, from the latest poll. */
  consumed: number
  /** From capabilities. */
  minChargeCredits: number
  /** The server's quoted cost for the whole job. */
  cost: number
  onKeepExporting: () => void
  onConfirmCancel: () => void
}

export function CancelExportDialog({
  isOpen,
  stage,
  reserved,
  consumed,
  minChargeCredits,
  cost,
  onKeepExporting,
  onConfirmCancel,
}: CancelExportDialogProps) {
  if (!isOpen) return null

  const projection = projectCancellation({ stage, reserved, consumed, minChargeCredits, cost })

  return (
    <CloudDialog
      title="Cancel this export?"
      maxWidth={400}
      onClose={onKeepExporting}
      footer={
        <>
          <Button variant="secondary" onClick={onKeepExporting}>
            Keep exporting
          </Button>
          <Button variant="destructive" onClick={onConfirmCancel}>
            Cancel export
          </Button>
        </>
      }
    >
      <CloudDialogSection>
        <p className="text-ui text-fg">{projection.body}</p>
        {!projection.free && (
          <>
            <p className="mt-3 text-sm text-muted">
              You&rsquo;ve used about{' '}
              <span className="whitespace-nowrap font-mono tabular-nums">{formatCredits(consumed)}</span> credits so
              far. Cancel now and{' '}
              <span className="whitespace-nowrap font-mono tabular-nums">{formatCredits(projection.charged)}</span> are
              charged (minimum {formatCredits(minChargeCredits)}); the rest is returned.
            </p>
            <p className="mt-3 text-sm text-muted">
              The final charge comes from the server, which returns any unused credits.
            </p>
          </>
        )}
      </CloudDialogSection>
    </CloudDialog>
  )
}
