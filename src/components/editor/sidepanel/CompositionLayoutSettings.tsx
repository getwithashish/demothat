// Inspector for the layout range selected on the timeline (DESIGN_SPEC §10).
// Flat Sections on the shared primitives.
import { useEditorStore } from '../../../store/editorStore'
import type { CompositionLayout } from '../../../types'
import { COMPOSITION_LAYOUTS } from '../../../lib/constants'
import { formatTime } from '../../../lib/utils'
import { Trash } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { HelperText } from '../../ui/helper-text'
import { Section } from '../../ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { PanelHeader } from '../PanelHeader'

const FIELD_CLASS =
  'mt-1 w-full rounded-ctl border border-line bg-ctl px-2 py-1.5 font-mono text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

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
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Layout range"
        subtitle="Controls how the screen recording and the presenter are arranged."
        actions={
          <button
            type="button"
            title="Delete layout"
            aria-label="Delete layout"
            onClick={() => {
              deleteCompositionLayout(selected.id)
              setSelectedRegionId(null)
            }}
            className="rounded-ctl p-1.5 text-muted hover:text-danger"
          >
            <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first label="Arrangement">
          <Select
            value={selected.layout}
            onValueChange={(layout) => updateCompositionLayout(selected.id, { layout: layout as CompositionLayout })}
          >
            <SelectTrigger aria-label="Layout">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPOSITION_LAYOUTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section label="Timing">
          <HelperText className="mt-0">
            You can also drag the clip on the timeline to move or resize this range.
          </HelperText>
          <div className="mt-3.5 grid grid-cols-3 gap-2">
            <label className="text-sm text-muted">
              Start (s)
              <input
                type="number"
                min="0"
                max={maxStart}
                step="0.1"
                aria-label="Layout start time"
                value={Number(selected.startTime.toFixed(2))}
                onChange={(event) =>
                  updateCompositionLayout(selected.id, {
                    startTime: Math.max(0, Math.min(maxStart, Number(event.target.value) || 0)),
                  })
                }
                className={FIELD_CLASS}
              />
            </label>
            <label className="text-sm text-muted">
              Duration (s)
              <input
                type="number"
                min="0.1"
                max={maxDuration}
                step="0.1"
                aria-label="Layout duration"
                value={Number(selected.duration.toFixed(2))}
                onChange={(event) =>
                  updateCompositionLayout(selected.id, {
                    duration: Math.max(0.1, Math.min(maxDuration, Number(event.target.value) || 0.1)),
                  })
                }
                className={FIELD_CLASS}
              />
            </label>
            <label className="text-sm text-muted">
              Fade (s)
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                aria-label="Layout fade duration"
                value={Number(selected.transitionDuration.toFixed(2))}
                onChange={(event) =>
                  updateCompositionLayout(selected.id, {
                    transitionDuration: Math.max(0, Math.min(2, Number(event.target.value) || 0)),
                  })
                }
                className={FIELD_CLASS}
              />
            </label>
          </div>
          <div className="mt-3.5 font-mono text-sm tabular-nums text-muted">
            {formatTime(selected.startTime)} – {formatTime(selected.startTime + selected.duration)}
          </div>
        </Section>
      </div>
    </div>
  )
}
