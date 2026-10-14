// Primary button to trigger video export (DESIGN_SPEC §10: flat primary, no glow).
import { Upload, Loader2 } from 'tabler-icons-react'
import { Button } from '../ui/button'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'

interface ExportButtonProps {
  onClick: () => void
  isExporting: boolean
  disabled?: boolean
}

export function ExportButton({ onClick, isExporting, disabled }: ExportButtonProps) {
  return (
    <Button onClick={onClick} disabled={isExporting || disabled}>
      {isExporting ? (
        <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2 animate-spin" />
      ) : (
        <Upload size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
      )}
      {isExporting ? 'Exporting…' : 'Export'}
    </Button>
  )
}
