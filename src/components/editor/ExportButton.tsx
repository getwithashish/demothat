// Primary button to trigger video export (DESIGN_SPEC §10: flat primary, no glow).
import { Upload, Loader2 } from 'tabler-icons-react'
import { Button } from '../ui/button'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'

interface ExportButtonProps {
  onClick: () => void
  isExporting: boolean
  isPublishing?: boolean
  disabled?: boolean
}

export function ExportButton({ onClick, isExporting, isPublishing = false, disabled }: ExportButtonProps) {
  const isBusy = isExporting || isPublishing
  return (
    <Button
      id="export-trigger-btn"
      onClick={onClick}
      disabled={isBusy ? false : disabled}
      title={
        isPublishing
          ? 'Publishing in progress — click to view'
          : isExporting
            ? 'Export in progress — click to view'
            : 'Export video or publish cloud link'
      }
    >
      {isBusy ? (
        <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2 animate-spin" />
      ) : (
        <Upload size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
      )}
      {isPublishing ? 'Publishing…' : isExporting ? 'Exporting…' : 'Export'}
    </Button>
  )
}
