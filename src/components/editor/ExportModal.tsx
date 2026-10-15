// Modal for configuring export settings and showing export progress (DESIGN_SPEC §10).
import { useEffect, useState, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Loader2, CircleCheck, CircleX, Folder, Ban } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { Input } from '../ui/input'
import { Section } from '../ui/section'
import { useEditorStore } from '../../store/editorStore'
import { formatTime } from '../../lib/utils'
import { RESOLUTIONS, RESOLUTION_OPTIONS, type ResolutionKey } from '../../../shared/export-resolutions'
import { GIF_MAX_HEIGHT } from '../../../shared/export-codec'
import { PanelHeader } from './PanelHeader'

export type ExportSettings = {
  format: 'mp4' | 'gif'
  resolution: ResolutionKey
  fps: 30 | 60
  quality: 'low' | 'medium' | 'high'
}

interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
  onMinimize?: () => void
  onStartExport: (settings: ExportSettings, outputPath: string) => void
  onCancelExport: () => void
  isExporting: boolean
  progress: number
  result: { success: boolean; outputPath?: string; error?: string } | null
}

const generateFilename = (format: 'mp4' | 'gif') => {
  const now = new Date()
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19)
  return `DemoThat-${timestamp}.${format}`
}

// --- Sub-components for different views ---
const SettingsView = ({
  onStartExport,
  onClose,
}: {
  onStartExport: (settings: ExportSettings, outputPath: string) => void
  onClose: () => void
}) => {
  const [settings, setSettings] = useState<ExportSettings>({
    format: 'mp4',
    resolution: '1080p',
    fps: 30,
    quality: 'medium',
  })
  const [outputPath, setOutputPath] = useState('')
  const [encoderCapabilities, setEncoderCapabilities] = useState<{ libx265: boolean } | null>(null)
  const { duration, cutRegions, speedRegions } = useEditorStore(
    useShallow((state) => ({
      duration: state.duration,
      cutRegions: state.cutRegions,
      speedRegions: state.speedRegions,
    })),
  )

  // Which encoders the bundled FFmpeg has; a missing libx265 disables 8K.
  // Until the answer arrives, assume available so the option does not flicker
  // (the main process still refuses an impossible export).
  useEffect(() => {
    window.electronAPI
      .getExportCapabilities()
      .then(setEncoderCapabilities)
      .catch(() => setEncoderCapabilities(null))
  }, [])

  const resolutionDisabledReason = (key: ResolutionKey): string | null => {
    if (key === '8k' && encoderCapabilities && !encoderCapabilities.libx265) {
      return 'needs HEVC (libx265), which this build lacks'
    }
    if (settings.format === 'gif' && RESOLUTIONS[key].height > GIF_MAX_HEIGHT) {
      return 'GIF is limited to 2K'
    }
    return null
  }

  const estimatedDuration = useMemo(() => {
    if (duration === 0) return 0

    let finalDuration = duration

    // Subtract cut regions
    Object.values(cutRegions).forEach((region) => {
      finalDuration -= region.duration
    })

    // Adjust for speed regions
    Object.values(speedRegions).forEach((region) => {
      // Subtract the original duration of the segment
      finalDuration -= region.duration
      // Add the new duration of the segment
      finalDuration += region.duration / region.speed
    })

    return Math.max(0, finalDuration)
  }, [duration, cutRegions, speedRegions])

  const handleValueChange = (key: keyof ExportSettings, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleFormatChange = (value: string) => {
    setSettings((prev) => {
      const format = value as ExportSettings['format']
      // GIF cannot go above 2K, so fall back rather than leaving an invalid pair.
      const resolution =
        format === 'gif' && RESOLUTIONS[prev.resolution].height > GIF_MAX_HEIGHT ? '1080p' : prev.resolution
      return { ...prev, format, resolution }
    })
  }

  const handleFpsChange = (value: string) => {
    setSettings((prev) => ({ ...prev, fps: value === '60' ? 60 : 30 }))
  }

  const handleBrowse = async () => {
    const result = await window.electronAPI.showSaveDialog({
      title: 'Save Video',
      defaultPath: outputPath,
      filters:
        settings.format === 'mp4'
          ? [{ name: 'MP4 Video', extensions: ['mp4'] }]
          : [{ name: 'GIF Animation', extensions: ['gif'] }],
    })

    if (!result.canceled && result.filePath) {
      setOutputPath(result.filePath)
    }
  }

  useEffect(() => {
    const setDefaultPath = async () => {
      try {
        const homePath = await window.electronAPI.getPath('home')
        const filename = generateFilename(settings.format)
        setOutputPath(`${homePath}/${filename}`)
      } catch (error) {
        console.error('Failed to get home path, falling back to relative path.', error)
        setOutputPath(generateFilename(settings.format))
      }
    }

    setDefaultPath()
  }, [settings.format])

  return (
    <div className="flex min-h-0 flex-col">
      <PanelHeader title="Export settings" subtitle="Configure your export options" />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first>
          <div className="space-y-3.5">
            <Select value={settings.format} onValueChange={handleFormatChange}>
              <SelectTrigger label="Format" aria-label="Format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mp4">MP4 (Video)</SelectItem>
                <SelectItem value="gif">GIF (Animation)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={settings.resolution} onValueChange={(value) => handleValueChange('resolution', value)}>
              <SelectTrigger label="Resolution" aria-label="Resolution">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_OPTIONS.map((option) => {
                  const reason = resolutionDisabledReason(option.key)
                  return (
                    <SelectItem
                      key={option.key}
                      value={option.key}
                      disabled={reason !== null}
                      title={reason ?? undefined}
                    >
                      {reason ? `${option.label} — ${reason}` : option.label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            <Select value={settings.quality} onValueChange={(value) => handleValueChange('quality', value)}>
              <SelectTrigger label="Quality" aria-label="Quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>

            <Select value={String(settings.fps)} onValueChange={handleFpsChange}>
              <SelectTrigger label="Frame rate" aria-label="Frame rate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 FPS</SelectItem>
                <SelectItem value="60">60 FPS</SelectItem>
              </SelectContent>
            </Select>

            <div className="space-y-1.5">
              <label htmlFor="export-output-path" className="block text-sm text-muted">
                Output file
              </label>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    id="export-output-path"
                    value={outputPath}
                    onChange={(e) => setOutputPath(e.target.value)}
                    placeholder="Loading default path…"
                    className="w-full"
                  />
                </div>
                <Button variant="secondary" onClick={handleBrowse} className="whitespace-nowrap">
                  Browse
                </Button>
              </div>
            </div>
          </div>
        </Section>

        <Section>
          <div className="flex items-center justify-between gap-3">
            <span className="text-ui text-fg">Estimated duration</span>
            <span className="font-mono text-sm tabular-nums text-muted">{formatTime(estimatedDuration, true)}</span>
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-line p-4">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onStartExport(settings, outputPath)} disabled={!outputPath}>
          Start export
        </Button>
      </div>
    </div>
  )
}

const ProgressView = ({ progress, onCancel }: { progress: number; onCancel: () => void }) => (
  <div className="flex flex-col items-center p-8 text-center">
    <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mb-4 animate-spin text-muted" />
    <h2 className="text-title font-semibold text-fg">Exporting…</h2>
    <p className="mt-0.5 text-sm text-muted">Please wait while we process your video.</p>
    <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-ctl">
      <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
    </div>
    <p className="mt-3 font-mono text-sm tabular-nums text-muted">{progress < 0.1 ? '< 1' : Math.round(progress)}%</p>
    <Button variant="secondary" onClick={onCancel} className="mt-6 w-full">
      Cancel
    </Button>
  </div>
)

const ResultView = ({ result, onClose }: { result: NonNullable<ExportModalProps['result']>; onClose: () => void }) => {
  const isCancelled = !result.success && result.error === 'Export cancelled.'

  const handleOpenFolder = () => {
    if (result.success && result.outputPath) {
      window.electronAPI.showItemInFolder(result.outputPath)
    }
  }

  const getTitle = () => {
    if (isCancelled) return 'Export cancelled'
    if (result.success) return 'Export successful'
    return 'Export failed'
  }

  const getMessage = () => {
    if (isCancelled) return 'The export process was stopped.'
    if (result.success) return 'Your video has been saved to the selected location.'
    return result.error || 'An unknown error occurred.'
  }

  const getIcon = () => {
    if (isCancelled) {
      return <Ban size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-muted" />
    }
    if (result.success) {
      return <CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-accent" />
    }
    return <CircleX size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-danger" />
  }

  return (
    <div className="flex flex-col items-center p-8 text-center">
      {getIcon()}
      <h2 className="mt-4 text-title font-semibold text-fg">{getTitle()}</h2>
      <p className="mt-0.5 max-w-xs break-words text-sm text-muted">{getMessage()}</p>
      <div className="mt-6 flex w-full gap-2">
        {result.success ? (
          <>
            <Button onClick={onClose} variant="secondary" className="flex-1">
              Close
            </Button>
            <Button onClick={handleOpenFolder} className="flex-1">
              <Folder size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
              Open folder
            </Button>
          </>
        ) : (
          <Button onClick={onClose} className="flex-1">
            Close
          </Button>
        )}
      </div>
    </div>
  )
}

// --- Main Modal Component ---
export function ExportModal({
  isOpen,
  onClose,
  onMinimize,
  onStartExport,
  onCancelExport,
  isExporting,
  progress,
  result,
}: ExportModalProps) {
  if (!isOpen) return null

  const renderContent = () => {
    if (result) {
      return <ResultView result={result} onClose={onClose} />
    }
    if (isExporting) {
      return <ProgressView progress={progress} onCancel={onCancelExport} />
    }
    return <SettingsView onStartExport={onStartExport} onClose={onClose} />
  }

  return (
    <div className="modal-backdrop flex items-center justify-center">
      <div
        className="card-clean pointer-events-auto m-4 flex w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {isExporting && onMinimize && (
          <div className="flex justify-end px-4 pt-3">
            <Button variant="ghost" size="sm" onClick={onMinimize}>
              Run in background
            </Button>
          </div>
        )}
        {renderContent()}
      </div>
    </div>
  )
}
