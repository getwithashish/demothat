import { Wand, Bolt, ZoomIn, Trash, Scissors } from 'tabler-icons-react'
import { useEditorStore } from '../../store/editorStore'
import { useAIChat } from './useAIChat'

export function AIContextStrip() {
  const selectedRegionId = useEditorStore((state) => state.selectedRegionId)
  const zoomRegions = useEditorStore((state) => state.zoomRegions)
  const cutRegions = useEditorStore((state) => state.cutRegions)
  const speedRegions = useEditorStore((state) => state.speedRegions)
  const currentTime = useEditorStore((state) => state.currentTime)
  const duration = useEditorStore((state) => state.duration)

  const { sendPrompt, isStreaming } = useAIChat()

  if (duration <= 0) return null

  // Check if a specific region is selected
  const selectedZoom = selectedRegionId ? zoomRegions[selectedRegionId] : null
  const selectedCut = selectedRegionId ? cutRegions[selectedRegionId] : null
  const selectedSpeed = selectedRegionId ? speedRegions[selectedRegionId] : null

  if (selectedZoom) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-xs text-fg">
        <div className="flex items-center gap-1.5 font-medium">
          <Wand size={14} className="text-indigo-400" />
          <span>
            Zoom ({selectedZoom.zoomLevel}× at {selectedZoom.startTime.toFixed(1)}s):
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Center selected zoom ${selectedZoom.id} on the nearest mouse click`)}
            className="rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium border border-border/50 hover:bg-ctl transition-colors disabled:opacity-50"
          >
            Center on click
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Set selected zoom ${selectedZoom.id} to 2.5x magnification`)}
            className="rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium border border-border/50 hover:bg-ctl transition-colors disabled:opacity-50"
          >
            2.5× zoom
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Make transition for zoom ${selectedZoom.id} faster (0.2s)`)}
            className="rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium border border-border/50 hover:bg-ctl transition-colors disabled:opacity-50"
          >
            Fast snap
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Delete selected zoom region ${selectedZoom.id}`)}
            className="rounded bg-panel/80 p-1 text-muted hover:text-danger hover:bg-ctl transition-colors disabled:opacity-50"
            title="Delete this zoom"
          >
            <Trash size={12} />
          </button>
        </div>
      </div>
    )
  }

  if (selectedCut) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs text-fg">
        <div className="flex items-center gap-1.5 font-medium">
          <Scissors size={14} className="text-rose-400" />
          <span>
            Cut Region ({selectedCut.duration.toFixed(1)}s at {selectedCut.startTime.toFixed(1)}s):
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Extend selected cut ${selectedCut.id} duration by 1 second`)}
            className="rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium border border-border/50 hover:bg-ctl transition-colors disabled:opacity-50"
          >
            +1s cut
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Delete selected cut region ${selectedCut.id}`)}
            className="rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium border border-border/50 text-danger hover:bg-ctl transition-colors disabled:opacity-50"
          >
            Remove cut
          </button>
        </div>
      </div>
    )
  }

  if (selectedSpeed) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-xs text-fg">
        <div className="flex items-center gap-1.5 font-medium">
          <Bolt size={14} className="text-amber-400" />
          <span>
            Speed ({selectedSpeed.speed}× at {selectedSpeed.startTime.toFixed(1)}s):
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Set selected speed region ${selectedSpeed.id} to 2x speed`)}
            className="rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium border border-border/50 hover:bg-ctl transition-colors disabled:opacity-50"
          >
            2×
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Set selected speed region ${selectedSpeed.id} to 4x speed`)}
            className="rounded bg-panel/80 px-2 py-0.5 text-[11px] font-medium border border-border/50 hover:bg-ctl transition-colors disabled:opacity-50"
          >
            4×
          </button>
          <button
            type="button"
            disabled={isStreaming}
            onClick={() => sendPrompt(`Delete selected speed region ${selectedSpeed.id}`)}
            className="rounded bg-panel/80 p-1 text-muted hover:text-danger hover:bg-ctl transition-colors disabled:opacity-50"
            title="Remove speed region"
          >
            <Trash size={12} />
          </button>
        </div>
      </div>
    )
  }

  // Default strip: quick contextual AI bar at current playhead
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-panel px-3 py-1 text-xs text-muted">
      <div className="flex items-center gap-1.5">
        <Wand size={13} className="text-indigo-400" />
        <span className="text-[11px] font-medium text-fg/80">Playhead at {currentTime.toFixed(1)}s</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={isStreaming}
          onClick={() => sendPrompt(`Add a zoom region at current playhead ${currentTime.toFixed(1)}s`)}
          className="flex items-center gap-1 rounded bg-ctl/30 px-2 py-0.5 text-[11px] text-fg hover:bg-ctl hover:text-accent transition-colors disabled:opacity-50"
        >
          <ZoomIn size={12} />
          <span>Zoom here</span>
        </button>
        <button
          type="button"
          disabled={isStreaming}
          onClick={() => sendPrompt(`Cut 2 seconds starting at playhead ${currentTime.toFixed(1)}s`)}
          className="flex items-center gap-1 rounded bg-ctl/30 px-2 py-0.5 text-[11px] text-fg hover:bg-ctl hover:text-danger transition-colors disabled:opacity-50"
        >
          <Scissors size={12} />
          <span>Cut here</span>
        </button>
        <button
          type="button"
          disabled={isStreaming}
          onClick={() => sendPrompt('Tidy up all silences and inactive stretches across the recording')}
          className="flex items-center gap-1 rounded bg-ctl/30 px-2 py-0.5 text-[11px] text-fg hover:bg-ctl hover:text-amber-400 transition-colors disabled:opacity-50"
        >
          <Bolt size={12} />
          <span>Tidy up</span>
        </button>
      </div>
    </div>
  )
}
