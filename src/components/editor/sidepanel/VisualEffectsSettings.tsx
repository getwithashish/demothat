// Inspector for a selected visual effect on the timeline or canvas.
// Flat Sections on shared primitives (DESIGN_SPEC §10).
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../../store/editorStore'
import type { VisualEffectRegion, VisualEffectKind, EffectShape } from '../../../types'
import { Section } from '../../ui/section'
import { Trash } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { PanelHeader } from '../PanelHeader'

const kinds: { value: VisualEffectKind; label: string }[] = [
  { value: 'mask', label: 'Mask area' },
  { value: 'blur', label: 'Sensitive blur' },
  { value: 'focus', label: 'Magnify & focus' },
  { value: 'border', label: 'Border highlight' },
]

const shapes: { value: EffectShape; label: string }[] = [
  { value: 'rectangle', label: 'Rectangle' },
  { value: 'square', label: 'Square' },
  { value: 'circle', label: 'Circle' },
  { value: 'freeform', label: 'Freeform' },
]

const FIELD_CLASS =
  'mt-1 w-full rounded-ctl border border-line bg-ctl px-2 py-1.5 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

function normalizeHexColor(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]
  }
  if (/^#[0-9a-fA-F]{8}$/.test(c)) {
    return c.slice(0, 7)
  }
  return '#38bdf8'
}

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
  const displayValue = Number.isFinite(value) ? Number(value.toFixed(3)) : min

  return (
    <label className="block text-sm text-muted">
      {label}
      <input
        aria-label={label}
        className={FIELD_CLASS}
        type="number"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={(e) => {
          const num = Number(e.target.value)
          if (!Number.isNaN(num)) {
            onChange(Math.max(min, Math.min(max, num)))
          }
        }}
      />
    </label>
  )
}

export function VisualEffectsSettings({ effect }: { effect?: VisualEffectRegion } = {}) {
  const { visualEffects, updateVisualEffect, deleteVisualEffect, selectedRegionId, setSelectedRegionId, duration } =
    useEditorStore(
      useShallow((s) => ({
        visualEffects: s.visualEffects,
        updateVisualEffect: s.updateVisualEffect,
        deleteVisualEffect: s.deleteVisualEffect,
        selectedRegionId: s.selectedRegionId,
        setSelectedRegionId: s.setSelectedRegionId,
        duration: s.duration,
      })),
    )

  const selected = effect ?? visualEffects.find((e) => e.id === selectedRegionId) ?? null
  if (!selected) return null

  const change = (patch: Partial<VisualEffectRegion>) => updateVisualEffect(selected.id, patch)

  const maxStart = duration > 0 ? Math.max(0, duration - selected.duration) : 999999
  const maxDuration = duration > 0 ? Math.max(0.1, duration - selected.startTime) : 999999

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Visual effect"
        subtitle="Adjust effect shape, timing, and parameters"
        actions={
          <button
            type="button"
            title="Delete effect"
            aria-label="Delete effect"
            onClick={() => {
              deleteVisualEffect(selected.id)
              setSelectedRegionId(null)
            }}
            className="rounded-ctl p-1.5 text-muted hover:text-danger"
          >
            <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first label="Type & Style">
          <label className="block text-sm text-muted">
            Kind
            <select
              aria-label="Effect kind"
              className={FIELD_CLASS}
              value={selected.kind}
              onChange={(e) => change({ kind: e.target.value as VisualEffectKind })}
            >
              {kinds.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3.5 grid grid-cols-2 gap-3">
            <label className="block text-sm text-muted">
              Shape
              <select
                aria-label="Shape"
                className={FIELD_CLASS}
                value={selected.shape}
                onChange={(e) => change({ shape: e.target.value as EffectShape })}
              >
                {shapes.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-muted">
              Color
              <input
                aria-label="Color"
                className="mt-1 block h-8 w-full rounded-ctl border border-line bg-ctl p-1"
                type="color"
                value={normalizeHexColor(selected.color)}
                onChange={(e) => change({ color: e.target.value })}
              />
            </label>
          </div>
        </Section>

        <Section label="Timing">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Start (s)"
              value={selected.startTime}
              min={0}
              max={maxStart}
              step={0.1}
              onChange={(startTime) => change({ startTime })}
            />
            <NumberField
              label="Duration (s)"
              value={selected.duration}
              min={0.1}
              max={maxDuration}
              step={0.1}
              onChange={(duration) => change({ duration })}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <NumberField
              label="Enter (s)"
              value={selected.enterDuration}
              min={0}
              max={10}
              step={0.1}
              onChange={(enterDuration) => change({ enterDuration })}
            />
            <NumberField
              label="Exit (s)"
              value={selected.exitDuration}
              min={0}
              max={10}
              step={0.1}
              onChange={(exitDuration) => change({ exitDuration })}
            />
          </div>
        </Section>

        <Section label="Position & Dimensions">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="X (0–1)"
              value={selected.x}
              min={0}
              max={1}
              step={0.01}
              onChange={(x) => change({ x })}
            />
            <NumberField
              label="Y (0–1)"
              value={selected.y}
              min={0}
              max={1}
              step={0.01}
              onChange={(y) => change({ y })}
            />
            <NumberField
              label="Width"
              value={selected.width}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(width) => change({ width })}
            />
            <NumberField
              label="Height"
              value={selected.height}
              min={0.01}
              max={1}
              step={0.01}
              onChange={(height) => change({ height })}
            />
          </div>
        </Section>

        {(selected.kind === 'blur' || selected.kind === 'focus' || selected.kind === 'border') && (
          <Section label="Parameters">
            {selected.kind === 'blur' && (
              <NumberField
                label="Blur strength (px)"
                value={selected.blur}
                min={0}
                max={80}
                step={1}
                onChange={(blur) => change({ blur })}
              />
            )}
            {selected.kind === 'focus' && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Magnification"
                  value={selected.scale}
                  min={1}
                  max={4}
                  step={0.1}
                  onChange={(scale) => change({ scale })}
                />
                <NumberField
                  label="Outside dim (0–0.9)"
                  value={selected.dimOutside}
                  min={0}
                  max={0.9}
                  step={0.05}
                  onChange={(dimOutside) => change({ dimOutside })}
                />
              </div>
            )}
            {(selected.kind === 'border' || selected.kind === 'focus') && (
              <div className={selected.kind === 'focus' ? 'mt-3' : undefined}>
                <NumberField
                  label="Border width"
                  value={selected.borderWidth}
                  min={1}
                  max={40}
                  step={1}
                  onChange={(borderWidth) => change({ borderWidth })}
                />
              </div>
            )}
            {selected.kind === 'border' && (
              <div className="mt-3">
                <label className="block text-sm text-muted">
                  Animation direction
                  <select
                    aria-label="Animation direction"
                    className={FIELD_CLASS}
                    value={selected.direction}
                    onChange={(e) => change({ direction: e.target.value as VisualEffectRegion['direction'] })}
                  >
                    <option value="in">In</option>
                    <option value="out">Out</option>
                    <option value="both">Both</option>
                  </select>
                </label>
              </div>
            )}
          </Section>
        )}

        <Section label="Animation">
          <div className="flex flex-wrap gap-4 text-sm text-muted">
            <label className="flex items-center gap-2">
              <input
                className="accent-accent"
                type="checkbox"
                checked={selected.animated}
                onChange={(e) => change({ animated: e.target.checked })}
              />
              Animate
            </label>
            <label className="flex items-center gap-2">
              <input
                className="accent-accent"
                type="checkbox"
                checked={selected.loop}
                onChange={(e) => change({ loop: e.target.checked })}
              />
              Loop
            </label>
          </div>
        </Section>
      </div>
    </div>
  )
}
