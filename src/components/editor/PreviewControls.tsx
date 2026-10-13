import React from 'react'
import { Scissors, ZoomIn, ZoomOut, Trash, ArrowBackUp, ArrowForwardUp, PlayerTrackNext, Camera } from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import type { AspectRatio } from '../../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Slider } from '../ui/slider'
import { cn } from '../../lib/utils'
import { useZoomControls } from '../../hooks/useZoomControls'

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'icon'
  children: React.ReactNode
}

const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  ({ variant = 'default', className = '', disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-semibold transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-40',
          variant === 'icon' ? 'h-10 w-10 rounded-xl' : 'h-10 px-4 rounded-xl text-sm gap-2',
          disabled
            ? 'bg-card/80 text-muted-foreground/50 border border-border/20 shadow-sm'
            : 'bg-card/90 text-foreground border border-border/40 shadow-sm hover:bg-accent hover:text-accent-foreground hover:border-border/60 hover:shadow-md',
          className,
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  },
)
ToolbarButton.displayName = 'ToolbarButton'

export function PreviewControls() {
  const {
    addZoomRegion,
    addCutRegion,
    addSpeedRegion,
    addCameraMotion,
    currentTime,
    duration,
    setSelectedRegionId,
    cameraMotions,
    deleteCameraMotion,
    timelineZoom,
    setTimelineZoom,
    selectedRegionId,
    deleteRegion,
    aspectRatio,
    setAspectRatio,
  } = useEditorStore()

  const { undo, redo, pastStates, futureStates } = useEditorStore.temporal.getState()

  // Interface zoom state + the zoom keyboard shortcuts (see useZoomControls).
  const { zoomFactor, zoomIn, zoomOut, resetZoom } = useZoomControls()

  const handleDelete = () => {
    if (selectedRegionId) {
      if (cameraMotions.some((motion) => motion.id === selectedRegionId)) deleteCameraMotion(selectedRegionId)
      else deleteRegion(selectedRegionId)
      setSelectedRegionId(null)
    }
  }

  return (
    <div className="h-18 bg-card/95 backdrop-blur-xl border-t border-border/60 flex items-center justify-between px-6 shadow-lg">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <ToolbarButton title="Add Zoom Region" onClick={() => addZoomRegion()} disabled={!!selectedRegionId}>
            <ZoomIn className="w-4 h-4" />
            <span>Zoom</span>
          </ToolbarButton>
          <ToolbarButton title="Add Cinematic 3D Camera" onClick={() => {
            const start = Math.max(0, Math.min(currentTime, Math.max(0, duration - 0.1)))
            addCameraMotion('dolly-in', start, Math.min(duration || start + 2, start + 2))
            const added = useEditorStore.getState().cameraMotions.at(-1)
            if (added) setSelectedRegionId(added.id)
          }}>
            <Camera className="w-4 h-4" />
            <span>3D Camera</span>
          </ToolbarButton>
          <ToolbarButton title="Add Cut Region" onClick={() => addCutRegion()} disabled={!!selectedRegionId}>
            <Scissors className="w-4 h-4" />
            <span>Trim</span>
          </ToolbarButton>
          <ToolbarButton title="Add Speed Region" onClick={() => addSpeedRegion()} disabled={!!selectedRegionId}>
            <PlayerTrackNext className="w-4 h-4" />
            <span>Speed</span>
          </ToolbarButton>
          <ToolbarButton
            variant="icon"
            title="Delete Selected Region"
            onClick={handleDelete}
            disabled={!selectedRegionId}
            className="text-red-600 border-red-500/25 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:border-red-400/30 dark:hover:bg-red-500/15 dark:hover:text-red-300"
          >
            <Trash className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-2">
          <ToolbarButton variant="icon" title="Undo (Ctrl+Z)" onClick={() => undo()} disabled={pastStates.length === 0}>
            <ArrowBackUp className="w-4 h-4" />
          </ToolbarButton>
          <ToolbarButton
            variant="icon"
            title="Redo (Ctrl+Y)"
            onClick={() => redo()}
            disabled={futureStates.length === 0}
          >
            <ArrowForwardUp className="w-4 h-4" />
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-2.5" title="Timeline zoom (Cmd/Ctrl + Shift +, −)">
          <ZoomIn className="w-4 h-4 text-muted-foreground" />
          <div className="w-24">
            <Slider min={1} max={4} step={0.5} value={timelineZoom} onChange={setTimelineZoom} />
          </div>
        </div>

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-0.5" title="Interface zoom (Cmd/Ctrl +, −, 0)">
          <span className="mr-1 text-xs font-semibold text-muted-foreground">UI</span>
          <ToolbarButton
            variant="icon"
            className="h-8 w-8"
            title="Zoom out interface (Cmd/Ctrl −)"
            aria-label="Zoom out interface"
            onClick={() => void zoomOut()}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </ToolbarButton>
          <button
            type="button"
            onClick={() => void resetZoom()}
            title="Reset interface zoom (Cmd/Ctrl 0)"
            aria-label="Reset interface zoom"
            className="min-w-[48px] rounded-lg px-1 py-1 text-xs font-semibold tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {Math.round(zoomFactor * 100)}%
          </button>
          <ToolbarButton
            variant="icon"
            className="h-8 w-8"
            title="Zoom in interface (Cmd/Ctrl +)"
            aria-label="Zoom in interface"
            onClick={() => void zoomIn()}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </ToolbarButton>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-muted-foreground">Aspect:</span>
        <div className="w-40">
          <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as AspectRatio)}>
            <SelectTrigger className="h-10 text-sm border-border bg-card shadow-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="16:9">16:9 Landscape</SelectItem>
              <SelectItem value="9:16">9:16 Portrait</SelectItem>
              <SelectItem value="4:3">4:3 Standard</SelectItem>
              <SelectItem value="3:4">3:4 Tall</SelectItem>
              <SelectItem value="1:1">1:1 Square</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
