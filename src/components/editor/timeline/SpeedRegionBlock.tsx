import { memo, useState } from 'react'
import { TimelineRegion, SpeedRegion } from '../../../types'
import { cn } from '../../../lib/utils'
import { PlayerTrackNext, Check } from 'tabler-icons-react'
import { useEditorStore } from '../../../store/editorStore'
import { ContextMenu, ContextMenuItem, ContextMenuDivider, ContextMenuLabel } from '../../ui/context-menu'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'

interface SpeedRegionBlockProps {
  region: SpeedRegion
  isSelected: boolean
  isBeingDragged: boolean
  onMouseDown: (
    e: React.MouseEvent<HTMLDivElement>,
    region: TimelineRegion,
    type: 'move' | 'resize-left' | 'resize-right',
  ) => void
  setRef: (el: HTMLDivElement | null) => void
}

const SPEED_OPTIONS = [1, 1.2, 1.4, 1.6, 2, 3, 4, 8, 16]

/**
 * Speed region (DESIGN_SPEC §8, flat restyle). Right-click menu, drag targets and
 * resize-handle hit areas are unchanged.
 */
export const SpeedRegionBlock = memo(
  ({ region, isSelected, isBeingDragged, onMouseDown, setRef }: SpeedRegionBlockProps) => {
    const [isMenuOpen, setMenuOpen] = useState(false)
    const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 })
    const { updateRegion, applySpeedToAll } = useEditorStore.getState()

    const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>, type: 'resize-left' | 'resize-right') => {
      // Move stopPropagation inside the check to allow right-clicks
      if (e.button === 0) {
        e.stopPropagation()
        onMouseDown(e, region, type)
      }
    }

    const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setMenuPosition({ x: e.clientX, y: e.clientY })
      setMenuOpen(true)
    }

    const handleSpeedSelect = (speed: number) => {
      updateRegion(region.id, { speed })
      setMenuOpen(false)
    }

    const handleApplyToAll = () => {
      applySpeedToAll(region.speed)
      setMenuOpen(false)
    }

    return (
      <>
        <div
          ref={setRef}
          data-region-id={region.id}
          className={cn(
            'absolute h-full w-full overflow-hidden rounded-clip border border-line bg-ctl',
            isBeingDragged ? 'cursor-grabbing' : 'cursor-grab',
            isSelected ? 'outline-solid outline-2 outline-accent' : 'hover:border-muted',
          )}
          style={{ willChange: 'transform, width' }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              e.stopPropagation()
              onMouseDown(e, region, 'move')
            }
          }}
          onContextMenu={handleContextMenu}
        >
          {/* Resize handles */}
          <div
            className="absolute left-0 top-0 z-10 flex h-full w-5 cursor-ew-resize items-center justify-center"
            onMouseDown={(e) => handleResizeMouseDown(e, 'resize-left')}
          >
            <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
          </div>
          <div
            className="absolute right-0 top-0 z-10 flex h-full w-5 cursor-ew-resize items-center justify-center"
            onMouseDown={(e) => handleResizeMouseDown(e, 'resize-right')}
          >
            <span className="h-[calc(100%-10px)] w-[3px] rounded-[2px] bg-accent" />
          </div>

          {/* Content */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-3">
            <span className="flex items-center gap-1.5 overflow-hidden">
              <PlayerTrackNext size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />
              <span className="truncate text-sm font-medium text-fg">{region.speed}x</span>
            </span>
          </div>
        </div>

        {/* Context Menu */}
        <ContextMenu
          isOpen={isMenuOpen}
          onClose={() => setMenuOpen(false)}
          position={menuPosition}
          className="min-w-[120px]"
        >
          <ContextMenuLabel>Speed</ContextMenuLabel>
          {SPEED_OPTIONS.map((speed) => (
            <ContextMenuItem key={speed} onClick={() => handleSpeedSelect(speed)}>
              <span className="flex-1">{speed}x</span>
              {region.speed === speed && <Check className="w-4 h-4" />}
            </ContextMenuItem>
          ))}
          <ContextMenuDivider />
          <ContextMenuItem onClick={handleApplyToAll}>Apply to all</ContextMenuItem>
        </ContextMenu>
      </>
    )
  },
)

SpeedRegionBlock.displayName = 'SpeedRegionBlock'
