import { useRef, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import type { CameraMoveKind, CameraPose, CameraMotionTrack } from '../../../types'
import { Slider } from '../../ui/slider'
import { Camera, Download, Refresh, Trash, Upload } from 'tabler-icons-react'

const KINDS: { value: CameraMoveKind; label: string }[] = [
  { value: 'dolly-in', label: 'Dolly in' }, { value: 'dolly-out', label: 'Dolly out' },
  { value: 'pan-left', label: 'Pan left' }, { value: 'pan-right', label: 'Pan right' },
  { value: 'entrance', label: 'Entrance' }, { value: 'orbit', label: 'Orbit' },
  { value: 'reset', label: 'Reset move' }, { value: 'breathing', label: 'Breathing' }, { value: 'custom', label: 'Custom' },
]
const PRESETS_KEY = 'screenarc.camera-motion-presets.v1'
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const DEFAULT_POSE: CameraPose = { x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 50 }

function getDestinationPose(kind: CameraMoveKind, from: CameraPose, currentTo: CameraPose): CameraPose {
  const to = copy(from)
  switch (kind) {
    case 'dolly-in': to.scale = from.scale * 1.18; to.rotationY = from.rotationY - 3; break
    case 'dolly-out': to.scale = from.scale / 1.18; to.rotationY = from.rotationY + 3; break
    case 'pan-left': to.x = from.x - 8; to.rotationY = from.rotationY + 5; break
    case 'pan-right': to.x = from.x + 8; to.rotationY = from.rotationY - 5; break
    case 'entrance': to.y = from.y - 10; to.scale = from.scale * 1.12; to.rotationX = from.rotationX - 4; to.rotationY = from.rotationY + 6; break
    case 'orbit': to.rotationY = from.rotationY + 24; to.rotationX = from.rotationX + 3; break
    case 'reset': return copy(DEFAULT_POSE)
    case 'breathing': to.scale = from.scale * 1.035; break
    case 'custom': return copy(currentTo)
  }
  return to
}

export function CameraMotionSettings() {
  const { cameraMotions, updateCameraMotion, deleteCameraMotion, selectedRegionId, setSelectedRegionId } = useEditorStore()
  const [presets, setPresets] = useState<CameraMotionTrack[]>(() => {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]') as CameraMotionTrack[] } catch { return [] }
  })
  const importRef = useRef<HTMLInputElement>(null)
  const selected = cameraMotions.find((track) => track.id === selectedRegionId)

  const savePreset = () => {
    if (!selected) return
    const name = window.prompt('Name this camera move preset', selected.name)
    if (!name?.trim()) return
    const next = [...presets, { ...copy(selected), id: `camera-preset-${Date.now()}`, name: name.trim() }]
    setPresets(next); localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
  }
  const exportPresets = () => {
    const blob = new Blob([JSON.stringify({ version: 1, presets }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'screenarc-camera-presets.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  const importPresets = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as { presets?: CameraMotionTrack[] } | CameraMotionTrack[]
      const incoming = Array.isArray(parsed) ? parsed : parsed.presets
      if (!Array.isArray(incoming) || incoming.some((item) => !item.from || !item.to || typeof item.name !== 'string')) throw new Error('Invalid preset file')
      const next = [...presets, ...incoming.map((item) => ({ ...item, id: `camera-preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }))]
      setPresets(next); localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    } catch { window.alert('Could not import this file. Choose a ScreenArc camera preset JSON file.') }
  }
  const applyPreset = (preset: CameraMotionTrack) => {
    if (!selected) return
    updateCameraMotion(selected.id, { name: preset.name, kind: preset.kind, easing: preset.easing, from: copy(preset.from), to: copy(preset.to) })
  }
  // The clip's starting pose is inferred from its move type. Only the destination
  // pose is user-editable, keeping the inspector simple and timeline-driven.
  const updatePose = (key: keyof CameraPose, value: number) => {
    if (selected) updateCameraMotion(selected.id, { to: { ...selected.to, [key]: value } })
  }

  if (!selected) return null
  return <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <header className="border-b border-sidebar-border p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Camera className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-sidebar-foreground">Cinematic 3D Camera</h2><p className="text-xs text-muted-foreground">Drag the clip edges on the timeline to set its timing.</p></div>
        <button type="button" title="Delete camera move" onClick={() => { deleteCameraMotion(selected.id); setSelectedRegionId(null) }} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash size={16} /></button>
      </div>
    </header>
    <div className="flex-1 space-y-5 overflow-y-auto p-5">
      <div className="space-y-2"><label className="text-xs font-medium text-sidebar-foreground">Camera move</label><select aria-label="Camera move type" className="h-9 w-full rounded-md border border-sidebar-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={selected.kind} onChange={(event) => {
        const kind = event.target.value as CameraMoveKind
        updateCameraMotion(selected.id, { kind, name: KINDS.find((item) => item.value === kind)?.label ?? 'Custom move', to: getDestinationPose(kind, selected.from, selected.to) })
      }}>{KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><p className="text-xs text-muted-foreground">Changing the move recalculates its destination from the clip’s starting pose. Choose Custom to keep your current destination.</p></div>
      <div className="space-y-2"><label className="text-xs font-medium text-sidebar-foreground">Motion curve</label><select aria-label="Motion curve" className="h-9 w-full rounded-md border border-sidebar-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" value={selected.easing} onChange={(e) => updateCameraMotion(selected.id, { easing: e.target.value })}>{['Smooth', 'Balanced', 'Dynamic', 'Gentle Spring', 'Bouncy Spring'].map((easing) => <option key={easing}>{easing}</option>)}</select><p className="text-xs text-muted-foreground">Controls acceleration and deceleration between the start and end poses. Compare the middle of the clip while previewing.</p></div>
      <section className="space-y-3 rounded-lg border border-sidebar-border p-3">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-sidebar-foreground">End pose</h3><button type="button" title="Reset end pose" onClick={() => updateCameraMotion(selected.id, { to: { ...DEFAULT_POSE } })} className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"><Refresh size={14} /></button></div>
        <p className="text-xs text-muted-foreground">Set the camera destination. The starting pose is preserved from the camera’s current position.</p>
        {([{key:'x',label:'Position X',min:-30,max:30,step:1,unit:'%'},{key:'y',label:'Position Y',min:-30,max:30,step:1,unit:'%'},{key:'scale',label:'Scale',min:0.5,max:1.6,step:0.01,unit:'×'},{key:'rotationX',label:'Rotation X',min:-45,max:45,step:1,unit:'°'},{key:'rotationY',label:'Rotation Y',min:-45,max:45,step:1,unit:'°'},{key:'rotationZ',label:'Rotation Z',min:-30,max:30,step:1,unit:'°'},{key:'perspective',label:'Perspective',min:0,max:100,step:1,unit:'%'}] as const).map(({key,label,min,max,step,unit}) => <div key={key} className="space-y-1"><div className="flex justify-between text-xs"><label className="text-muted-foreground">{label}</label><span className="font-medium tabular-nums text-sidebar-foreground">{selected.to[key]}{unit}</span></div><Slider min={min} max={max} step={step} value={selected.to[key]} onChange={(value) => updatePose(key, value)} /></div>)}
        <button type="button" onClick={savePreset} className="w-full rounded-md border border-sidebar-border bg-background px-3 py-2 text-xs font-medium text-foreground hover:bg-accent hover:text-accent-foreground">Save selected move as preset</button>
      </section>
      <section className="space-y-3 border-t border-sidebar-border pt-4"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-sidebar-foreground">Motion presets</h3><div className="flex gap-1"><button type="button" title="Import presets" onClick={() => importRef.current?.click()} className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"><Upload size={15} /></button><button type="button" title="Export presets" onClick={exportPresets} className="rounded p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"><Download size={15} /></button></div></div>
        <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void importPresets(e.target.files?.[0]); e.currentTarget.value = '' }} />
        {presets.length === 0 && <p className="text-xs text-muted-foreground">Save a camera move to build your reusable preset library.</p>}
        {presets.map((preset) => <div key={preset.id} className="flex items-center gap-2 rounded-md border border-sidebar-border p-2"><span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground">{preset.name}</span><button type="button" onClick={() => applyPreset(preset)} className="rounded border border-sidebar-border px-2 py-1 text-xs text-foreground hover:bg-accent">Apply</button><button type="button" title="Remove preset" onClick={() => { const next = presets.filter((item) => item.id !== preset.id); setPresets(next); localStorage.setItem(PRESETS_KEY, JSON.stringify(next)) }} className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash size={13} /></button></div>)}
      </section>
    </div>
  </div>
}
