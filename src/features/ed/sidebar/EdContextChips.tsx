/**
 * Ed Context Chips — shows current playhead, selected region, and clip context.
 * Updates are throttled to ~10 Hz via useEdContext to avoid re-rendering message list.
 * Chips are removable so user can exclude context from next request.
 */
import { useState } from 'react'
import { X, Clock, ZoomIn, Movie } from 'tabler-icons-react'
import { useEdContext } from '../hooks/useEdContext'
import { useEditorStore } from '../../../store/editorStore'
import { formatTime } from '../../../lib/utils'
import { cn } from '../../../lib/utils'

interface ContextChip {
  id: string
  icon: React.ReactNode
  label: string
}

export function EdContextChips() {
  const ctx = useEdContext()
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const zoomRegions = useEditorStore((s) => s.zoomRegions)
  const cutRegions = useEditorStore((s) => s.cutRegions)
  const videoPath = useEditorStore((s) => s.videoPath)

  // Find selected region label
  const selectedLabel = ctx.selectedRegionId
    ? zoomRegions[ctx.selectedRegionId]
      ? 'Selection: Zoom'
      : cutRegions[ctx.selectedRegionId]
        ? 'Selection: Cut'
        : `Selection: ${ctx.selectedRegionId}`
    : null

  const chips: ContextChip[] = [
    {
      id: 'playhead',
      icon: <Clock size={11} />,
      label: `Playhead ${formatTime(ctx.currentTime)}`,
    },
    ...(selectedLabel
      ? [
          {
            id: 'selection',
            icon: <ZoomIn size={11} />,
            label: selectedLabel,
          },
        ]
      : []),
    ...(videoPath
      ? [
          {
            id: 'clip',
            icon: <Movie size={11} />,
            label: 'Clip: Screen',
          },
        ]
      : []),
  ].filter((c) => !removedIds.has(c.id))

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 px-3.5 py-1.5">
      {chips.map((chip) => (
        <span
          key={chip.id}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-line bg-ctl/60 px-2 py-0.5',
            'font-mono text-[11px] text-muted',
          )}
        >
          {chip.icon}
          {chip.label}
          <button
            type="button"
            aria-label={`Remove ${chip.label} context`}
            className="ml-0.5 rounded-full text-muted hover:text-fg transition-colors"
            onClick={() => setRemovedIds((prev) => new Set([...prev, chip.id]))}
          >
            <X size={10} />
          </button>
        </span>
      ))}
    </div>
  )
}
