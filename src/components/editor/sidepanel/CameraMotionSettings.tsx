// Inspector for a selected 3D camera clip. Flat Sections on the shared primitives (§10).
import { useRef, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import type { CameraMoveKind, CameraPose, CameraMotionTrack } from '../../../types'
import { Slider } from '../../ui/slider'
import { Button } from '../../ui/button'
import { HelperText } from '../../ui/helper-text'
import { Section } from '../../ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Download, Refresh, Trash, Upload } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { PanelHeader } from '../PanelHeader'

const KINDS: { value: CameraMoveKind; label: string }[] = [
  { value: 'dolly-in', label: 'Dolly in' },
  { value: 'dolly-out', label: 'Dolly out' },
  { value: 'pan-left', label: 'Pan left' },
  { value: 'pan-right', label: 'Pan right' },
  { value: 'entrance', label: 'Entrance' },
  { value: 'orbit', label: 'Orbit' },
  { value: 'reset', label: 'Reset move' },
  { value: 'breathing', label: 'Breathing' },
  { value: 'custom', label: 'Custom' },
]
const PRESETS_KEY = 'demothat.camera-motion-presets.v1'
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const DEFAULT_POSE: CameraPose = { x: 0, y: 0, scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, perspective: 50 }

function getDestinationPose(kind: CameraMoveKind, from: CameraPose, currentTo: CameraPose): CameraPose {
  const to = copy(from)
  switch (kind) {
    case 'dolly-in':
      to.scale = from.scale * 1.18
      to.rotationY = from.rotationY - 3
      break
    case 'dolly-out':
      to.scale = from.scale / 1.18
      to.rotationY = from.rotationY + 3
      break
    case 'pan-left':
      to.x = from.x - 8
      to.rotationY = from.rotationY + 5
      break
    case 'pan-right':
      to.x = from.x + 8
      to.rotationY = from.rotationY - 5
      break
    case 'entrance':
      to.y = from.y - 10
      to.scale = from.scale * 1.12
      to.rotationX = from.rotationX - 4
      to.rotationY = from.rotationY + 6
      break
    case 'orbit':
      to.rotationY = from.rotationY + 24
      to.rotationX = from.rotationX + 3
      break
    case 'reset':
      return copy(DEFAULT_POSE)
    case 'breathing':
      to.scale = from.scale * 1.035
      break
    case 'custom':
      return copy(currentTo)
  }
  return to
}

const POSE_FIELDS: {
  key: keyof CameraPose
  label: string
  min: number
  max: number
  step: number
  format: (value: number) => string
}[] = [
  { key: 'x', label: 'Position X', min: -30, max: 30, step: 1, format: (v) => `${v}%` },
  { key: 'y', label: 'Position Y', min: -30, max: 30, step: 1, format: (v) => `${v}%` },
  { key: 'scale', label: 'Scale', min: 0.5, max: 1.6, step: 0.01, format: (v) => `${v.toFixed(2)}\u00d7` },
  { key: 'rotationX', label: 'Rotation X', min: -45, max: 45, step: 1, format: (v) => `${v}\u00b0` },
  { key: 'rotationY', label: 'Rotation Y', min: -45, max: 45, step: 1, format: (v) => `${v}\u00b0` },
  { key: 'rotationZ', label: 'Rotation Z', min: -30, max: 30, step: 1, format: (v) => `${v}\u00b0` },
  { key: 'perspective', label: 'Perspective', min: 0, max: 100, step: 1, format: (v) => `${v}%` },
]

export function CameraMotionSettings() {
  const { cameraMotions, updateCameraMotion, deleteCameraMotion, selectedRegionId, setSelectedRegionId } =
    useEditorStore()
  const [presets, setPresets] = useState<CameraMotionTrack[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]') as CameraMotionTrack[]
    } catch {
      return []
    }
  })
  const importRef = useRef<HTMLInputElement>(null)
  const selected = cameraMotions.find((track) => track.id === selectedRegionId)

  const savePreset = () => {
    if (!selected) return
    const name = window.prompt('Name this camera move preset', selected.name)
    if (!name?.trim()) return
    const next = [...presets, { ...copy(selected), id: `camera-preset-${Date.now()}`, name: name.trim() }]
    setPresets(next)
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
  }
  const exportPresets = () => {
    const blob = new Blob([JSON.stringify({ version: 1, presets }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'demothat-camera-presets.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const importPresets = async (file?: File) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as { presets?: CameraMotionTrack[] } | CameraMotionTrack[]
      const incoming = Array.isArray(parsed) ? parsed : parsed.presets
      if (!Array.isArray(incoming) || incoming.some((item) => !item.from || !item.to || typeof item.name !== 'string'))
        throw new Error('Invalid preset file')
      const next = [
        ...presets,
        ...incoming.map((item) => ({
          ...item,
          id: `camera-preset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        })),
      ]
      setPresets(next)
      localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
    } catch {
      window.alert('Could not import this file. Choose a DemoThat camera preset JSON file.')
    }
  }
  const applyPreset = (preset: CameraMotionTrack) => {
    if (!selected) return
    updateCameraMotion(selected.id, {
      name: preset.name,
      kind: preset.kind,
      easing: preset.easing,
      from: copy(preset.from),
      to: copy(preset.to),
    })
  }
  // The clip's starting pose is inferred from its move type. Only the destination
  // pose is user-editable, keeping the inspector simple and timeline-driven.
  const updatePose = (key: keyof CameraPose, value: number) => {
    if (selected) updateCameraMotion(selected.id, { to: { ...selected.to, [key]: value } })
  }

  if (!selected) return null
  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Cinematic 3D camera"
        subtitle="Drag the clip edges on the timeline to set its timing."
        actions={
          <button
            type="button"
            title="Delete camera move"
            aria-label="Delete camera move"
            onClick={() => {
              deleteCameraMotion(selected.id)
              setSelectedRegionId(null)
            }}
            className="rounded-ctl p-1.5 text-muted hover:text-danger"
          >
            <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first label="Camera move">
          <Select
            value={selected.kind}
            onValueChange={(kind) => {
              const next = kind as CameraMoveKind
              updateCameraMotion(selected.id, {
                kind: next,
                name: KINDS.find((item) => item.value === next)?.label ?? 'Custom move',
                to: getDestinationPose(next, selected.from, selected.to),
              })
            }}
          >
            <SelectTrigger aria-label="Camera move type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <HelperText>
            Changing the move recalculates its destination from the clip's starting pose. Choose Custom to keep your
            current destination.
          </HelperText>
        </Section>

        <Section label="Motion curve">
          <Select value={selected.easing} onValueChange={(easing) => updateCameraMotion(selected.id, { easing })}>
            <SelectTrigger aria-label="Motion curve">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['Smooth', 'Balanced', 'Dynamic', 'Gentle Spring', 'Bouncy Spring'].map((easing) => (
                <SelectItem key={easing} value={easing}>
                  {easing}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <HelperText>
            Controls acceleration and deceleration between the start and end poses. Compare the middle of the clip while
            previewing.
          </HelperText>
        </Section>

        <Section
          label="End pose"
          labelRight={
            <Button
              variant="ghost"
              size="icon"
              title="Reset end pose"
              aria-label="Reset end pose"
              onClick={() => updateCameraMotion(selected.id, { to: { ...DEFAULT_POSE } })}
            >
              <Refresh size={ICON_SIZE} strokeWidth={ICON_STROKE} />
            </Button>
          }
        >
          <HelperText className="mt-0">
            Set the camera destination. The starting pose is preserved from the camera's current position.
          </HelperText>
          <div className="mt-3.5 space-y-3.5">
            {POSE_FIELDS.map(({ key, label, min, max, step, format }) => (
              <Slider
                key={key}
                label={label}
                min={min}
                max={max}
                step={step}
                value={selected.to[key]}
                onChange={(value) => updatePose(key, value)}
                formatValue={format}
              />
            ))}
          </div>
          <Button variant="secondary" className="mt-3.5 w-full" onClick={savePreset}>
            Save selected move as preset
          </Button>
        </Section>

        <Section
          label="Motion presets"
          labelRight={
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                title="Import presets"
                aria-label="Import presets"
                onClick={() => importRef.current?.click()}
              >
                <Upload size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Export presets"
                aria-label="Export presets"
                onClick={exportPresets}
              >
                <Download size={ICON_SIZE} strokeWidth={ICON_STROKE} />
              </Button>
            </div>
          }
        >
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              void importPresets(e.target.files?.[0])
              e.currentTarget.value = ''
            }}
          />
          {presets.length === 0 && (
            <HelperText className="mt-0">Save a camera move to build your reusable preset library.</HelperText>
          )}
          {presets.length > 0 && (
            <div className="divide-y divide-line border-t border-line">
              {presets.map((preset) => (
                <div key={preset.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-fg">{preset.name}</span>
                  <Button variant="secondary" size="sm" onClick={() => applyPreset(preset)}>
                    Apply
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove preset"
                    aria-label={`Remove ${preset.name}`}
                    className="text-danger"
                    onClick={() => {
                      const next = presets.filter((item) => item.id !== preset.id)
                      setPresets(next)
                      localStorage.setItem(PRESETS_KEY, JSON.stringify(next))
                    }}
                  >
                    <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
