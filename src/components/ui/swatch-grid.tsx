import { cn } from '../../lib/utils'

export interface SwatchItem {
  /** Caller-owned identifier passed back to `onSelect`. */
  id: string
  /** Human label; also the accessible name. */
  label: string
  /** Solid colour swatch. Ignored when `imageUrl` or `style` is set. */
  color?: string
  /** Thumbnail/image swatch (wallpapers). */
  imageUrl?: string
  /** Escape hatch for non-solid previews (e.g. a gradient direction preview). */
  style?: React.CSSProperties
}

export interface SwatchGridProps {
  items: SwatchItem[]
  selectedId?: string | null
  onSelect: (id: string) => void
  /** Grid columns. DESIGN_SPEC §6 uses 6. */
  columns?: number
  className?: string
  'aria-label'?: string
}

/**
 * Swatch grid (DESIGN_SPEC §6): squares in a grid, 8px gap, 6px radius,
 * 1px rgba(128,128,128,.3) border. Selected = 2px accent outline, 2px offset.
 */
export function SwatchGrid({
  items,
  selectedId,
  onSelect,
  columns = 6,
  className,
  'aria-label': ariaLabel,
}: SwatchGridProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('grid gap-2', className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item) => {
        const selected = item.id === selectedId
        return (
          <button
            key={item.id}
            type="button"
            aria-label={item.label}
            aria-pressed={selected}
            title={item.label}
            onClick={() => onSelect(item.id)}
            className={cn(
              'aspect-square overflow-hidden rounded-ctl',
              'border border-[rgba(128,128,128,0.3)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              selected ? 'outline-solid outline-2 outline-offset-2 outline-accent' : 'hover:border-fg/40',
            )}
          >
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span
                className="block h-full w-full"
                style={item.style ?? { backgroundColor: item.color ?? 'transparent' }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
