// Motion panel: default animation applied to new (or all) zoom regions.
// Flat Sections on the shared primitives — no Collapsible, no icon tiles.
import { useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { Check, Wand } from 'tabler-icons-react'
import { ZOOM, DEFAULTS } from '../../../lib/constants'
import { EASING_MAP } from '../../../lib/easing'
import { Button } from '../../ui/button'
import { HelperText } from '../../ui/helper-text'
import { Section, SectionLabel } from '../../ui/section'
import { SegmentedControl } from '../../ui/segmented-control'
import { Slider } from '../../ui/slider'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { PanelHeader } from '../PanelHeader'

const speedOptions = Object.keys(ZOOM.SPEED_OPTIONS)
const easingOptions = Object.keys(EASING_MAP)

export function AnimationSettingsPanel() {
  const { applyAnimationSettingsToAll } = useEditorStore.getState()

  // Local state
  const [speed, setSpeed] = useState(DEFAULTS.ANIMATION.SPEED.defaultValue)
  const [easing, setEasing] = useState(DEFAULTS.ANIMATION.EASING.defaultValue)
  const [zoomLevel, setZoomLevel] = useState(DEFAULTS.ANIMATION.ZOOM_LEVEL.defaultValue)
  const [applyStatus, setApplyStatus] = useState<'idle' | 'applied'>('idle')

  const handleApplyToAll = () => {
    if (applyStatus !== 'idle') return

    const transitionDuration = ZOOM.SPEED_OPTIONS[speed as keyof typeof ZOOM.SPEED_OPTIONS]
    applyAnimationSettingsToAll({ transitionDuration, easing, zoomLevel })

    setApplyStatus('applied')
    setTimeout(() => setApplyStatus('idle'), 2000)
  }

  const handleResetAnimation = () => {
    setSpeed(DEFAULTS.ANIMATION.SPEED.defaultValue)
    setEasing(DEFAULTS.ANIMATION.EASING.defaultValue)
    setZoomLevel(DEFAULTS.ANIMATION.ZOOM_LEVEL.defaultValue)
  }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Motion" subtitle="Default animation for all zoom regions" />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section
          first
          label="Speed"
          labelRight={
            <Button variant="ghost" size="sm" onClick={handleResetAnimation} aria-label="Reset animation settings">
              Reset
            </Button>
          }
        >
          <SegmentedControl
            aria-label="Speed"
            options={speedOptions.map((option) => ({ value: option, label: option }))}
            value={speed}
            onChange={setSpeed}
          />

          <div className="mt-3.5 space-y-2">
            <SectionLabel>Easing</SectionLabel>
            <Select value={easing} onValueChange={setEasing}>
              <SelectTrigger aria-label="Easing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {easingOptions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Section>

        <Section label="Zoom">
          <Slider
            label="Zoom level"
            min={DEFAULTS.ANIMATION.ZOOM_LEVEL.min}
            max={DEFAULTS.ANIMATION.ZOOM_LEVEL.max}
            step={DEFAULTS.ANIMATION.ZOOM_LEVEL.step}
            value={zoomLevel}
            onChange={setZoomLevel}
            formatValue={(value) => `${value.toFixed(1)}\u00d7`}
          />
          <HelperText>Applies to new zoom regions. Existing regions keep their values until you apply.</HelperText>
        </Section>

        <Section>
          <Button className="w-full" onClick={handleApplyToAll} disabled={applyStatus !== 'idle'}>
            {applyStatus === 'idle' ? (
              <>
                <Wand size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                Apply to all zoom regions
              </>
            ) : (
              <>
                <Check size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                Applied
              </>
            )}
          </Button>
        </Section>
      </div>
    </div>
  )
}
