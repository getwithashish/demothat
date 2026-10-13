import { useEditorStore } from '../../../store/editorStore'
import type { VisualEffectRegion, VisualEffectKind, EffectShape } from '../../../types'
import { Button } from '../../ui/button'
import { Trash, Plus } from 'tabler-icons-react'

const kinds: { value: VisualEffectKind; label: string }[] = [
  { value: 'mask', label: 'Mask area' }, { value: 'blur', label: 'Sensitive blur' },
  { value: 'focus', label: 'Magnify & focus' }, { value: 'border', label: 'Border highlight' },
]
function NumberField({ label, value, min, max, step = 0.05, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v:number)=>void }) {
  return <label className="block text-xs text-muted-foreground">{label}<input className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-foreground" type="number" min={min} max={max} step={step} value={Number(value.toFixed(3))} onChange={e=>onChange(Math.max(min, Math.min(max, Number(e.target.value)||0)))} /></label>
}
function EffectEditor({ effect }: { effect: VisualEffectRegion }) {
  const update = useEditorStore(s=>s.updateVisualEffect)
  const remove = useEditorStore(s=>s.deleteVisualEffect)
  const change = (patch: Partial<VisualEffectRegion>) => update(effect.id, patch)
  return <div className="space-y-3 rounded-lg border border-border p-3">
    <div className="flex items-center gap-2"><select className="min-w-0 flex-1 rounded-md border border-input bg-background p-2 text-sm" value={effect.kind} onChange={e=>change({kind:e.target.value as VisualEffectKind})}>{kinds.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</select><Button variant="ghost" size="sm" onClick={()=>remove(effect.id)} aria-label="Delete effect"><Trash className="h-4 w-4"/></Button></div>
    <div className="grid grid-cols-2 gap-2"><label className="text-xs text-muted-foreground">Shape<select className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground" value={effect.shape} onChange={e=>change({shape:e.target.value as EffectShape})}>{(['rectangle','square','circle','freeform'] as EffectShape[]).map(s=><option key={s} value={s}>{s}</option>)}</select></label><label className="text-xs text-muted-foreground">Color<input className="mt-1 block h-9 w-full rounded-md border border-input bg-background p-1" type="color" value={effect.color.startsWith('#')?effect.color:'#38bdf8'} onChange={e=>change({color:e.target.value})}/></label></div>
    <div className="grid grid-cols-2 gap-2"><NumberField label="Start (s)" value={effect.startTime} min={0} max={999999} onChange={startTime=>change({startTime})}/><NumberField label="Duration (s)" value={effect.duration} min={0.1} max={999999} onChange={duration=>change({duration})}/></div>
    <div className="grid grid-cols-2 gap-2"><NumberField label="X (0–1)" value={effect.x} min={0} max={1} onChange={x=>change({x})}/><NumberField label="Y (0–1)" value={effect.y} min={0} max={1} onChange={y=>change({y})}/><NumberField label="Width" value={effect.width} min={0.01} max={1} onChange={width=>change({width})}/><NumberField label="Height" value={effect.height} min={0.01} max={1} onChange={height=>change({height})}/></div>
    {(effect.kind==='blur') && <NumberField label="Blur strength (px)" value={effect.blur} min={0} max={80} step={1} onChange={blur=>change({blur})}/>}
    {(effect.kind==='focus') && <div className="grid grid-cols-2 gap-2"><NumberField label="Magnification" value={effect.scale} min={1} max={4} step={0.1} onChange={scale=>change({scale})}/><NumberField label="Outside dim (0–0.9)" value={effect.dimOutside} min={0} max={0.9} onChange={dimOutside=>change({dimOutside})}/></div>}
    {(effect.kind==='border'||effect.kind==='focus') && <NumberField label="Border width" value={effect.borderWidth} min={1} max={40} step={1} onChange={borderWidth=>change({borderWidth})}/>}
    <div className="grid grid-cols-2 gap-2"><NumberField label="Enter (s)" value={effect.enterDuration} min={0} max={10} onChange={enterDuration=>change({enterDuration})}/><NumberField label="Exit (s)" value={effect.exitDuration} min={0} max={10} onChange={exitDuration=>change({exitDuration})}/></div>
    <div className="flex flex-wrap gap-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={effect.animated} onChange={e=>change({animated:e.target.checked})}/>Animate</label><label className="flex items-center gap-2"><input type="checkbox" checked={effect.loop} onChange={e=>change({loop:e.target.checked})}/>Loop</label></div>
    {effect.kind==='border' && <label className="block text-xs text-muted-foreground">Animation direction<select className="mt-1 w-full rounded-md border border-input bg-background p-2 text-foreground" value={effect.direction} onChange={e=>change({direction:e.target.value as VisualEffectRegion['direction']})}><option value="in">In</option><option value="out">Out</option><option value="both">Both</option></select></label>}
  </div>
}
export function VisualEffectsSettings() {
  const effects = useEditorStore(s=>s.visualEffects)
  const add = useEditorStore(s=>s.addVisualEffect)
  return <section className="space-y-3 border-t border-sidebar-border pt-6"><div><h3 className="text-sm font-semibold">Masking & visual effects</h3><p className="mt-1 text-xs text-muted-foreground">Effects are scoped to their start time and duration and included in export.</p></div>
    <div className="grid grid-cols-2 gap-2">{kinds.map(k=><Button key={k.value} variant="outline" size="sm" onClick={()=>add(k.value)}><Plus className="mr-1 h-3 w-3"/>{k.label}</Button>)}</div>
    {effects.length===0 ? <p className="text-xs text-muted-foreground">No effects yet. Add a mask, blur, focus, or border effect.</p> : effects.map(effect=><EffectEditor key={effect.id} effect={effect}/>)}
  </section>
}
