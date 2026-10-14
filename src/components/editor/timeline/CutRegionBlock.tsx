import { memo } from 'react'
import { TimelineRegion, CutRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { Scissors } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'

interface CutRegionBlockProps {
  region: CutRegion
  isSelected: boolean
  isDraggable?: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

/**
 * Cut / trim region (DESIGN_SPEC §8, flat restyle). Geometry, drag targets and the
 * drag/delete threshold behaviour are unchanged; only surfaces and handles changed.
 *
 * NOTE: the previous version painted 45° stripes with `rgb(var(--destructive) / 0.15)`.
 * `--destructive` resolves to a hex token, so that declaration was invalid and never
 * painted — the stripes were dead CSS (and a gradient, which AGENTS.md forbids beyond
 * the spec). The remaining flat tint is what actually rendered, so removing it is a
 * no-op visually.
 */
export const CutRegionBlock = memo(
  ({ region, isSelected, isDraggable = true, isBeingDragged, onMouseDown, setRef }: CutRegionBlockProps) => {
    const isTrimRegion = !!region.trimType
    const canMove = isDraggable && !isTrimRegion
    const canResizeLeft = isDraggable && region.trimType !== 'start'
    const canResizeRight = isDraggable && region.trimType !== 'end'

    const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, type: 'move' | 'resize-left' | 'resize-right') => {
      e.stopPropagation()
      if (!isDraggable) return
      onMouseDown(e, region, type)
    }

    return (
      <div
        ref={setRef}
        data-region-id={region.id}
        className="relative h-full w-full"
        style={{ willChange: 'transform, width' }}
      >
        {/* Flat tint marking the range that will be removed. */}
        <div className="pointer-events-none absolute left-0 top-0 h-[230px] w-full translate-y-[-200px] overflow-hidden rounded-t-clip">
          <div className="absolute inset-0 bg-danger/15" />
        </div>

        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center overflow-hidden rounded-clip border border-danger/60 bg-ctl',
            canMove ? (isBeingDragged ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default',
            isSelected ? 'outline-solid outline-2 outline-accent' : canMove && 'hover:border-danger',
          )}
          onMouseDown={(e) => handleMouseDown(e, 'move')}
        >
          {canResizeLeft && (
            <div
              className="absolute left-0 top-0 z-10 flex h-full w-5 cursor-ew-resize items-center justify-center"
              onMouseDown={(e) => handleMouseDown(e, 'resize-left')}
            >
              <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-danger/70" />
            </div>
          )}

          <div className="pointer-events-none flex items-center gap-1.5 overflow-hidden px-3">
            <Scissors size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-danger" />
            <span className="truncate text-sm font-medium text-fg">Cut</span>
          </div>

          {canResizeRight && (
            <div
              className="absolute right-0 top-0 z-10 flex h-full w-5 cursor-ew-resize items-center justify-center"
              onMouseDown={(e) => handleMouseDown(e, 'resize-right')}
            >
              <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-danger/70" />
            </div>
          )}
        </div>
      </div>
    )
  },
)
CutRegionBlock.displayName = 'CutRegionBlock'
