// "Effects" section for the Layout panel: quick-add buttons plus the selected
// effect's inspector. Flat Section, shared primitives, no card-in-card.
import { useEditorStore } from '../../../store/editorStore'
import type { VisualEffectRegion, VisualEffectKind, EffectShape } from '../../../types'
import { Button } from '../../ui/button'
import { HelperText } from '../../ui/helper-text'
import { Section } from '../../ui/section'
import { Trash } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'

const kinds: { value: VisualEffectKind; label: string }[] = [
  { value: 'mask', label: 'Mask area' },
  { value: 'blur', label: 'Sensitive blur' },
  { value: 'focus', label: 'Magnify & focus' },
  { value: 'border', label: 'Border highlight' },
]

const FIELD_CLASS =
  'mt-1 w-full rounded-ctl border border-line bg-ctl px-2 py-1.5 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function NumberField({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-sm text-muted">
      {label}
      <input
        className={FIELD_CLASS}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(3))}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
      />
    </label>
  )
}

function EffectEditor({ effect }: { effect: VisualEffectRegion }) {
  const update = useEditorStore((s) => s.updateVisualEffect)
  const remove = useEditorStore((s) => s.deleteVisualEffect)
  const change = (patch: Partial<VisualEffectRegion>) => update(effect.id, patch)

  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <select
          aria-label="Effect kind"
          className="min-w-0 flex-1 rounded-ctl border border-line bg-ctl px-2 py-1.5 text-ui text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          value={effect.kind}
          onChange={(e) => change({ kind: e.target.value as VisualEffectKind })}
        >
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <Button variant="danger" size="icon" onClick={() => remove(effect.id)} aria-label="Delete effect">
          <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-muted">
          Shape
          <select
            className={FIELD_CLASS}
            value={effect.shape}
            onChange={(e) => change({ shape: e.target.value as EffectShape })}
          >
            {(['rectangle', 'square', 'circle', 'freeform'] as EffectShape[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-muted">
          Color
          <input
            className="mt-1 block h-8 w-full rounded-ctl border border-line bg-ctl p-1"
            type="color"
            value={effect.color.startsWith('#') ? effect.color : '#38bdf8'}
            onChange={(e) => change({ color: e.target.value })}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Start (s)" value={effect.startTime} min={0} max={999999} onChange={(startTime) => change({ startTime })} />
        <NumberField label="Duration (s)" value={effect.duration} min={0.1} max={999999} onChange={(duration) => change({ duration })} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="X (0–1)" value={effect.x} min={0} max={1} onChange={(x) => change({ x })} />
        <NumberField label="Y (0–1)" value={effect.y} min={0} max={1} onChange={(y) => change({ y })} />
        <NumberField label="Width" value={effect.width} min={0.01} max={1} onChange={(width) => change({ width })} />
        <NumberField label="Height" value={effect.height} min={0.01} max={1} onChange={(height) => change({ height })} />
      </div>

      {effect.kind === 'blur' && (
        <NumberField label="Blur strength (px)" value={effect.blur} min={0} max={80} step={1} onChange={(blur) => change({ blur })} />
      )}
      {effect.kind === 'focus' && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Magnification" value={effect.scale} min={1} max={4} step={0.1} onChange={(scale) => change({ scale })} />
          <NumberField label="Outside dim (0–0.9)" value={effect.dimOutside} min={0} max={0.9} onChange={(dimOutside) => change({ dimOutside })} />
        </div>
      )}
      {(effect.kind === 'border' || effect.kind === 'focus') && (
        <NumberField label="Border width" value={effect.borderWidth} min={1} max={40} step={1} onChange={(borderWidth) => change({ borderWidth })} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Enter (s)" value={effect.enterDuration} min={0} max={10} onChange={(enterDuration) => change({ enterDuration })} />
        <NumberField label="Exit (s)" value={effect.exitDuration} min={0} max={10} onChange={(exitDuration) => change({ exitDuration })} />
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-muted">
        <label className="flex items-center gap-2">
          <input className="accent-accent" type="checkbox" checked={effect.animated} onChange={(e) => change({ animated: e.target.checked })} />
          Animate
        </label>
        <label className="flex items-center gap-2">
          <input className="accent-accent" type="checkbox" checked={effect.loop} onChange={(e) => change({ loop: e.target.checked })} />
          Loop
        </label>
      </div>

      {effect.kind === 'border' && (
        <label className="block text-sm text-muted">
          Animation direction
          <select
            className={FIELD_CLASS}
            value={effect.direction}
            onChange={(e) => change({ direction: e.target.value as VisualEffectRegion['direction'] })}
          >
            <option value="in">In</option>
            <option value="out">Out</option>
            <option value="both">Both</option>
          </select>
        </label>
      )}
    </div>
  )
}

export function VisualEffectsSettings() {
  const effects = useEditorStore((s) => s.visualEffects)
  const selectedRegionId = useEditorStore((s) => s.selectedRegionId)
  const add = useEditorStore((s) => s.addVisualEffect)
  const selectedEffect = effects.find((effect) => effect.id === selectedRegionId)

  return (
    <Section label="Effects">
      <div className="grid grid-cols-2 gap-2">
        {kinds.map((k) => (
          <Button key={k.value} variant="secondary" size="sm" onClick={() => add(k.value)}>
            {k.label}
          </Button>
        ))}
      </div>
      <HelperText>Select a mask or visual effect clip on the timeline to show its settings here.</HelperText>
      {selectedEffect && <EffectEditor key={selectedEffect.id} effect={selectedEffect} />}
    </Section>
  )
}
