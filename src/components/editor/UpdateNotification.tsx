// Notification button for available app updates (DESIGN_SPEC §10: flat, tokenised).
import { Download } from 'tabler-icons-react'
import { Button } from '../ui/button'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'

interface UpdateNotificationProps {
  info: {
    version: string
    url: string
  }
}

export function UpdateNotification({ info }: UpdateNotificationProps) {
  const handleDownload = () => {
    window.electronAPI.openExternal(info.url)
  }

  return (
    <Button
      data-version={info.version}
      variant="secondary"
      size="sm"
      onClick={handleDownload}
      aria-label="Update available"
      className="text-accent"
    >
      <Download size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
      Update available
    </Button>
  )
}
