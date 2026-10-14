import { memo } from 'react'
import { TimelineRegion, ZoomRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { Search } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'

interface ZoomRegionBlockProps {
  region: ZoomRegion
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

/**
 * Zoom region (DESIGN_SPEC §8): ctl fill, 1px line, 5px radius, centred 12px/500 label
 * with a 16px-style icon (18px per the AGENTS hard rule), 3px accent trim bars inset 5px,
 * selected = 2px accent outline.
 *
 * The root element is the drag target: `willChange` and the resize-handle hit areas are
 * unchanged from the previous version, so the drag/trim math and hit-testing are identical.
 */
export const ZoomRegionBlock = memo(
  ({ region, isSelected, isBeingDragged, onMouseDown, setRef }: ZoomRegionBlockProps) => {
    const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>, type: 'resize-left' | 'resize-right') => {
      e.stopPropagation()
      onMouseDown(e, region, type)
    }

    return (
      <div
        ref={setRef}
        data-region-id={region.id}
        className={cn(
          'group/zoom-region absolute h-full w-full overflow-hidden rounded-clip border border-line bg-ctl',
          isBeingDragged ? 'cursor-grabbing' : 'cursor-grab',
          isSelected ? 'outline-solid outline-2 outline-accent' : 'hover:border-muted',
        )}
        style={{ willChange: 'transform, width' }}
        onMouseDown={(e) => onMouseDown(e, region, 'move')}
      >
        <div
          className="absolute left-0 top-0 z-10 flex h-full w-5 cursor-ew-resize items-center justify-center"
          onMouseDown={(e) => handleResizeMouseDown(e, 'resize-left')}
        >
          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-3">
          <span className="flex items-center gap-1.5 overflow-hidden">
            <Search size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />
            <span className="truncate text-sm font-medium text-fg">Zoom</span>
          </span>
        </div>

        <div
          className="absolute right-0 top-0 z-10 flex h-full w-5 cursor-ew-resize items-center justify-center"
          onMouseDown={(e) => handleResizeMouseDown(e, 'resize-right')}
        >
          <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
        </div>
      </div>
    )
  },
)

ZoomRegionBlock.displayName = 'ZoomRegionBlock'
