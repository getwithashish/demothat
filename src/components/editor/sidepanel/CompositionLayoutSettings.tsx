// Inspector for the layout range selected on the timeline. Mirrors the other
// per-region inspectors (camera motion, zoom/cut/speed) so a selected layout
// edits in the side panel instead of a section buried in Camera Settings.
import { useEditorStore } from '../../../store/editorStore'
import type { CompositionLayout } from '../../../types'
import { COMPOSITION_LAYOUTS } from '../../../lib/constants'
import { formatTime } from '../../../lib/utils'
import { LayoutBoard, Trash } from 'tabler-icons-react'

export function CompositionLayoutSettings() {
  const {
    compositionLayouts,
    updateCompositionLayout,
    deleteCompositionLayout,
    selectedRegionId,
    setSelectedRegionId,
    duration,
  } = useEditorStore()

  const selected = compositionLayouts.find((range) => range.id === selectedRegionId)
  if (!selected) return null

  const maxStart = Math.max(0, duration - selected.duration)
  const maxDuration = Math.max(0.1, duration - selected.startTime)

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <header className="border-b border-sidebar-border p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <LayoutBoard className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-sidebar-foreground">Layout</h2>
            <p className="text-xs text-muted-foreground">
              Controls how the screen recording and the presenter are arranged.
            </p>
          </div>
          <button
            type="button"
            title="Delete layout"
            onClick={() => {
              deleteCompositionLayout(selected.id)
              setSelectedRegionId(null)
            }}
            className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash size={16} />
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto stable-scrollbar p-5">
        <div className="space-y-2">
          <label className="text-xs font-medium text-sidebar-foreground">Arrangement</label>
          <select
            aria-label="Layout"
            value={selected.layout}
            onChange={(event) => updateCompositionLayout(selected.id, { layout: event.target.value as CompositionLayout })}
            className="h-9 w-full rounded-md border border-sidebar-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {COMPOSITION_LAYOUTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <section className="space-y-3 rounded-lg border border-sidebar-border p-3">
          <h3 className="text-sm font-semibold text-sidebar-foreground">Timing</h3>
          <p className="text-xs text-muted-foreground">
            You can also drag the clip on the timeline to move or resize this range.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[11px] text-muted-foreground">
              Start (s)
              <input
                type="number"
                min="0"
                max={maxStart}
                step="0.1"
                value={Number(selected.startTime.toFixed(2))}
                onChange={(event) =>
                  updateCompositionLayout(selected.id, {
                    startTime: Math.max(0, Math.min(maxStart, Number(event.target.value) || 0)),
                  })
                }
                className="mt-1 w-full rounded-md border border-input bg-background p-2 text-xs text-foreground"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Duration (s)
              <input
                type="number"
                min="0.1"
                max={maxDuration}
                step="0.1"
                value={Number(selected.duration.toFixed(2))}
                onChange={(event) =>
                  updateCompositionLayout(selected.id, {
                    duration: Math.max(0.1, Math.min(maxDuration, Number(event.target.value) || 0.1)),
                  })
                }
                className="mt-1 w-full rounded-md border border-input bg-background p-2 text-xs text-foreground"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              Fade (s)
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={Number(selected.transitionDuration.toFixed(2))}
                onChange={(event) =>
                  updateCompositionLayout(selected.id, {
                    transitionDuration: Math.max(0, Math.min(2, Number(event.target.value) || 0)),
                  })
                }
                className="mt-1 w-full rounded-md border border-input bg-background p-2 text-xs text-foreground"
              />
            </label>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          {formatTime(selected.startTime)} – {formatTime(selected.startTime + selected.duration)}
        </p>
      </div>
    </div>
  )
}
