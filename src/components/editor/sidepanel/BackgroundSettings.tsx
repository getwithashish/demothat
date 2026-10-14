// Background controls for the Layout panel (wallpaper, colour, gradient, image).
// Rebuilt on the shared primitives: flat Section, SegmentedControl, SwatchGrid, ColorField.
import type React from 'react'
import { useState, useRef, useEffect } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { WALLPAPERS } from '../../../lib/constants'
import { CloudUpload } from 'tabler-icons-react'
import { Button } from '../../ui/button'
import { ColorField } from '../../ui/color-field'
import { HelperText } from '../../ui/helper-text'
import { Section } from '../../ui/section'
import { SegmentedControl } from '../../ui/segmented-control'
import { SwatchGrid, type SwatchItem } from '../../ui/swatch-grid'

type BackgroundTab = 'color' | 'gradient' | 'image' | 'wallpaper'

const TAB_OPTIONS: { value: BackgroundTab; label: string }[] = [
  { value: 'wallpaper', label: 'Wallpaper' },
  { value: 'color', label: 'Color' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
]

const COLOR_PRESETS = [
  '#7c3aed',
  '#3b82f6',
  '#10b981',
  '#ef4444',
  '#f97316',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#eab308',
  '#6366f1',
  '#6b7280',
  '#000000',
  '#ffffff',
  '#f43f5e',
  '#22c55e',
  '#0ea5e9',
  '#d946ef',
]

const GRADIENT_PRESETS = [
  { name: 'Top to Bottom', direction: 'to bottom' },
  { name: 'Bottom to Top', direction: 'to top' },
  { name: 'Left to Right', direction: 'to right' },
  { name: 'Right to Left', direction: 'to left' },
  { name: 'Top-Left to Bottom-Right', direction: 'to bottom right' },
  { name: 'Bottom-Right to Top-Left', direction: 'to top left' },
  { name: 'Top-Right to Bottom-Left', direction: 'to bottom left' },
  { name: 'Bottom-Left to Top-Right', direction: 'to top right' },
  { name: 'Center Out', direction: 'circle-out' },
  { name: 'Center In', direction: 'circle-in' },
]

const gradientPreview = (direction: string): React.CSSProperties => {
  if (direction === 'circle-in') return { background: 'radial-gradient(circle, #ffffff, #808080)' }
  if (direction.startsWith('circle')) return { background: 'radial-gradient(circle, #808080, #ffffff)' }
  return { background: `linear-gradient(${direction}, #808080, #ffffff)` }
}

const WallpaperSelector = () => {
  const { frameStyles, updateBackground } = useEditorStore()
  const items: SwatchItem[] = WALLPAPERS.slice(0, 18).map((wallpaper, index) => ({
    id: wallpaper.thumbnailUrl,
    label: `Wallpaper ${index + 1}`,
    imageUrl: wallpaper.thumbnailUrl || '/placeholder.svg',
  }))

  return (
    <SwatchGrid
      aria-label="Wallpaper"
      items={items}
      selectedId={frameStyles.background.thumbnailUrl ?? null}
      onSelect={(thumbnailUrl) => {
        const wallpaper = WALLPAPERS.find((entry) => entry.thumbnailUrl === thumbnailUrl)
        if (wallpaper) {
          updateBackground({ type: 'wallpaper', thumbnailUrl: wallpaper.thumbnailUrl, imageUrl: wallpaper.imageUrl })
        }
      }}
    />
  )
}

const ColorSelector = () => {
  const { frameStyles, updateBackground } = useEditorStore()
  const items: SwatchItem[] = COLOR_PRESETS.map((color) => ({ id: color, label: color, color }))

  return (
    <div className="space-y-3">
      <SwatchGrid
        aria-label="Background colour"
        items={items}
        selectedId={frameStyles.background.color ?? null}
        onSelect={(color) => updateBackground({ type: 'color', color })}
      />
      <ColorField
        label="Custom colour"
        value={frameStyles.background.color || '#ffffff'}
        onChange={(color) => updateBackground({ type: 'color', color })}
      />
    </div>
  )
}

const GradientSelector = () => {
  const { frameStyles, updateBackground } = useEditorStore()
  const [localGradient, setLocalGradient] = useState({
    start: frameStyles.background.gradientStart || '#6366f1',
    end: frameStyles.background.gradientEnd || '#9ca9ff',
  })

  useEffect(() => {
    if (frameStyles.background.type === 'gradient') {
      setLocalGradient({
        start: frameStyles.background.gradientStart || '#6366f1',
        end: frameStyles.background.gradientEnd || '#9ca9ff',
      })
    }
  }, [frameStyles.background.gradientStart, frameStyles.background.gradientEnd, frameStyles.background.type])

  const handleApplyGradient = () =>
    updateBackground({
      type: 'gradient',
      gradientStart: localGradient.start,
      gradientEnd: localGradient.end,
      gradientDirection: frameStyles.background.gradientDirection,
    })

  const items: SwatchItem[] = GRADIENT_PRESETS.map((preset) => ({
    id: preset.direction,
    label: preset.name,
    style: gradientPreview(preset.direction),
  }))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <ColorField
          label="Start"
          value={localGradient.start}
          onChange={(start) => setLocalGradient((previous) => ({ ...previous, start }))}
        />
        <ColorField
          label="End"
          value={localGradient.end}
          onChange={(end) => setLocalGradient((previous) => ({ ...previous, end }))}
        />
      </div>
      <SwatchGrid
        aria-label="Gradient direction"
        columns={5}
        items={items}
        selectedId={frameStyles.background.gradientDirection ?? null}
        onSelect={(gradientDirection) => updateBackground({ type: 'gradient', gradientDirection })}
      />
      <Button variant="secondary" className="w-full" onClick={handleApplyGradient}>
        Apply colours
      </Button>
    </div>
  )
}

const ImageSelector = () => {
  const { frameStyles, updateBackground } = useEditorStore()
  const imageInputRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const imageUrl = URL.createObjectURL(e.target.files[0])
      updateBackground({ type: 'image', imageUrl })
    }
  }

  const removeUploadedImage = () => {
    if (frameStyles.background.imageUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(frameStyles.background.imageUrl)
    }
    updateBackground({
      type: 'wallpaper',
      imageUrl: WALLPAPERS[0].imageUrl,
      thumbnailUrl: WALLPAPERS[0].thumbnailUrl,
    })
  }

  const hasImage = Boolean(frameStyles.background.imageUrl) && frameStyles.background.type === 'image'

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-ctl border border-dashed border-line">
        {hasImage ? (
          <div className="relative">
            <img
              src={frameStyles.background.imageUrl || '/placeholder.svg'}
              alt="Background"
              className="h-40 w-full object-cover"
            />
            <div className="flex items-center justify-end gap-2 border-t border-line bg-panel px-2 py-2">
              <Button variant="secondary" size="sm" onClick={() => imageInputRef.current?.click()}>
                Replace
              </Button>
              <Button variant="danger" size="sm" onClick={removeUploadedImage}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <CloudUpload size={24} strokeWidth={1.6} className="text-muted" />
            <div>
              <p className="text-ui text-fg">Upload image</p>
              <p className="text-sm text-muted">PNG, JPG, GIF up to 10MB</p>
            </div>
          </div>
        )}
      </div>

      <Button variant="secondary" className="w-full" onClick={() => imageInputRef.current?.click()}>
        Choose image
      </Button>
      <HelperText>Or drop an image here — it becomes the video background.</HelperText>

      <input ref={imageInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
    </div>
  )
}

export function BackgroundSettings() {
  const { frameStyles } = useEditorStore()
  const [activeTab, setActiveTab] = useState<BackgroundTab>(frameStyles.background.type)

  useEffect(() => {
    setActiveTab(frameStyles.background.type)
  }, [frameStyles.background.type])

  return (
    <Section first label="Background">
      <SegmentedControl
        aria-label="Background type"
        options={TAB_OPTIONS}
        value={activeTab}
        onChange={(value) => setActiveTab(value)}
      />

      <div className="mt-3">
        {activeTab === 'wallpaper' && <WallpaperSelector />}
        {activeTab === 'color' && <ColorSelector />}
        {activeTab === 'gradient' && <GradientSelector />}
        {activeTab === 'image' && <ImageSelector />}
      </div>
    </Section>
  )
}
