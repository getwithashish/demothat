import { useState } from 'react'
import {
  Scissors,
  ZoomIn,
  ZoomOut,
  Trash,
  ArrowBackUp,
  ArrowForwardUp,
  PlayerTrackNext,
  Camera,
  LayoutBoard,
  ChevronDown,
} from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import type { AspectRatio, CompositionLayout } from '../../types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Slider } from '../ui/slider'
import { Button } from '../ui/button'
import { ToolbarButton } from '../ui/toolbar-button'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { COMPOSITION_LAYOUTS } from '../../lib/constants'
import { ContextMenu, ContextMenuItem, ContextMenuLabel } from '../ui/context-menu'
import { useZoomControls } from '../../hooks/useZoomControls'

const iconProps = { size: ICON_SIZE, strokeWidth: ICON_STROKE } as const

export function PreviewControls() {
  const {
    addZoomRegion,
    addCutRegion,
    addSpeedRegion,
    addCameraMotion,
    addCompositionLayout,
    currentTime,
    duration,
    setSelectedRegionId,
    cameraMotions,
    deleteCameraMotion,
    timelineZoom,
    setTimelineZoom,
    selectedRegionId,
    deleteRegion,
    compositionLayouts,
    deleteCompositionLayout,
    aspectRatio,
    setAspectRatio,
  } = useEditorStore()

  const { undo, redo, pastStates, futureStates } = useEditorStore.temporal.getState()

  // Interface zoom state + the zoom keyboard shortcuts (see useZoomControls).
  const { zoomFactor, zoomIn, zoomOut, resetZoom } = useZoomControls()

  // Layout type menu: the main button keeps adding picture-in-picture (previous
  // behaviour); the caret opens the type list, which the Camera panel used to offer.
  const [isLayoutMenuOpen, setLayoutMenuOpen] = useState(false)
  const [layoutMenuPosition, setLayoutMenuPosition] = useState({ x: 0, y: 0 })

  const addLayout = (layout: CompositionLayout) => {
    addCompositionLayout(layout)
    const added = useEditorStore.getState().compositionLayouts.at(-1)
    if (added) setSelectedRegionId(added.id)
  }

  const handleDelete = () => {
    if (selectedRegionId) {
      if (cameraMotions.some((motion) => motion.id === selectedRegionId)) deleteCameraMotion(selectedRegionId)
      else if (compositionLayouts.some((range) => range.id === selectedRegionId))
        deleteCompositionLayout(selectedRegionId)
      else deleteRegion(selectedRegionId)
      setSelectedRegionId(null)
    }
  }

  const layoutDisabled = duration <= currentTime

  return (
    <div className="flex flex-wrap items-center justify-between gap-y-1.5 border-b border-line bg-panel px-3 py-2.5">
      <div className="flex items-center gap-1">
        <ToolbarButton
          icon={<ZoomIn {...iconProps} />}
          title="Add Zoom Region"
          onClick={() => addZoomRegion()}
          disabled={!!selectedRegionId}
        >
          Zoom
        </ToolbarButton>
        <ToolbarButton
          icon={<Camera {...iconProps} />}
          title="Add Cinematic 3D Camera"
          onClick={() => {
            const start = Math.max(0, Math.min(currentTime, Math.max(0, duration - 0.1)))
            addCameraMotion('dolly-in', start, Math.min(duration || start + 2, start + 2))
            const added = useEditorStore.getState().cameraMotions.at(-1)
            if (added) setSelectedRegionId(added.id)
          }}
        >
          3D Camera
        </ToolbarButton>

        <div className="flex items-center">
          <ToolbarButton
            icon={<LayoutBoard {...iconProps} />}
            title="Add Layout at the playhead"
            disabled={layoutDisabled}
            className="rounded-r-none"
            onClick={() => addLayout('picture-in-picture')}
          >
            Layout
          </ToolbarButton>
          <ToolbarButton
            iconOnly
            icon={<ChevronDown {...iconProps} />}
            title="Choose a layout type"
            aria-label="Choose a layout type"
            disabled={layoutDisabled}
            className="-ml-px rounded-l-none"
            onClick={(event) => {
              const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect()
              setLayoutMenuPosition({ x: rect.left, y: rect.bottom + 4 })
              setLayoutMenuOpen(true)
            }}
          />
        </div>

        <ToolbarButton
          icon={<Scissors {...iconProps} />}
          title="Add Cut Region"
          onClick={() => addCutRegion()}
          disabled={!!selectedRegionId}
        >
          Trim
        </ToolbarButton>
        <ToolbarButton
          icon={<PlayerTrackNext {...iconProps} />}
          title="Add Speed Region"
          onClick={() => addSpeedRegion()}
          disabled={!!selectedRegionId}
        >
          Speed
        </ToolbarButton>
        <Button
          variant="danger"
          size="icon"
          title="Delete Selected Region"
          aria-label="Delete selected region"
          onClick={handleDelete}
          disabled={!selectedRegionId}
        >
          <Trash {...iconProps} />
        </Button>

        <div className="mx-0.5 h-5 w-px bg-line" />

        <ToolbarButton
          iconOnly
          icon={<ArrowBackUp {...iconProps} />}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          onClick={() => undo()}
          disabled={pastStates.length === 0}
        />
        <ToolbarButton
          iconOnly
          icon={<ArrowForwardUp {...iconProps} />}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          onClick={() => redo()}
          disabled={futureStates.length === 0}
        />

        <div className="mx-0.5 h-5 w-px bg-line" />

        <div className="flex items-center gap-2" title="Timeline zoom (Cmd/Ctrl + Shift +, −)">
          <ZoomOut {...iconProps} className="text-muted" />
          <div className="w-16">
            <Slider min={1} max={4} step={0.5} value={timelineZoom} onChange={setTimelineZoom} />
          </div>
        </div>

        <div className="mx-0.5 h-5 w-px bg-line" />

        <div className="flex items-center gap-1" title="Interface zoom (Cmd/Ctrl +, −, 0)">
          <span className="mr-1 text-sm font-medium text-muted">UI</span>
          <ToolbarButton
            iconOnly
            icon={<ZoomOut {...iconProps} />}
            title="Zoom out interface (Cmd/Ctrl −)"
            aria-label="Zoom out interface"
            onClick={() => void zoomOut()}
          />
          <button
            type="button"
            onClick={() => void resetZoom()}
            title="Reset interface zoom (Cmd/Ctrl 0)"
            aria-label="Reset interface zoom"
            className="h-8 min-w-[48px] rounded-ctl px-1 font-mono text-sm tabular-nums text-muted transition-colors hover:bg-ctl hover:text-fg"
          >
            {Math.round(zoomFactor * 100)}%
          </button>
          <ToolbarButton
            iconOnly
            icon={<ZoomIn {...iconProps} />}
            title="Zoom in interface (Cmd/Ctrl +)"
            aria-label="Zoom in interface"
            onClick={() => void zoomIn()}
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted">Aspect:</span>
        <Select value={aspectRatio} onValueChange={(value) => setAspectRatio(value as AspectRatio)}>
          <SelectTrigger className="h-8 w-36" aria-label="Aspect ratio">
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

      <ContextMenu
        isOpen={isLayoutMenuOpen}
        onClose={() => setLayoutMenuOpen(false)}
        position={layoutMenuPosition}
        className="min-w-[200px]"
      >
        <ContextMenuLabel>Layout type</ContextMenuLabel>
        {COMPOSITION_LAYOUTS.map((option) => (
          <ContextMenuItem
            key={option.value}
            onClick={() => {
              addLayout(option.value)
              setLayoutMenuOpen(false)
            }}
          >
            {option.label}
          </ContextMenuItem>
        ))}
      </ContextMenu>
    </div>
  )
}
