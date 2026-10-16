// Offer to keep watching a cloud export that outlived the app (spec C3).
//
// The job kept running on the server while the app was closed; this asks before
// downloading its result.

import { Cloud } from 'tabler-icons-react'
import { Button } from '../../ui/button'
import { CloudDialog } from './CloudDialog'

export interface ResumeCloudDialogProps {
  isOpen: boolean
  /** The output path the finished job will be written to. */
  outputPath: string | null
  onResume: () => void
  onDismiss: () => void
}

export function ResumeCloudDialog({ isOpen, outputPath, onResume, onDismiss }: ResumeCloudDialogProps) {
  if (!isOpen) return null

  return (
    <CloudDialog
      title="A cloud export is still running"
      variant="state"
      maxWidth={380}
      icon={<Cloud size={28} strokeWidth={1.6} className="text-muted" />}
      subtitle={
        outputPath
          ? `It kept going while the app was closed. We can download the result to ${outputPath} now.`
          : 'It kept going while the app was closed. We can keep watching it now.'
      }
      onClose={onDismiss}
      footer={
        <>
          <Button variant="secondary" onClick={onDismiss}>
            Not now
          </Button>
          <Button onClick={onResume}>Resume</Button>
        </>
      }
    />
  )
}
