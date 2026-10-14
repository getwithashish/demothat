// Per-zoom-region animation editor (inspector for a selected zoom region).
// Flat Section on the shared primitives — no Collapsible (DESIGN_SPEC §10).
import { useEditorStore } from '../../../store/editorStore'
import type { ZoomRegion } from '../../../types'
import { ZOOM, DEFAULTS } from '../../../lib/constants'
import { EASING_MAP } from '../../../lib/easing'
import { Button } from '../../ui/button'
import { Section, SectionLabel } from '../../ui/section'
import { SegmentedControl } from '../../ui/segmented-control'
import { Slider } from '../../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'

const speedOptions = Object.keys(ZOOM.SPEED_OPTIONS)
const easingOptions = Object.keys(EASING_MAP)

interface AnimationSettingsProps {
  region: ZoomRegion
}

export function AnimationSettings({ region }: AnimationSettingsProps) {
  const { updateRegion } = useEditorStore.getState()

  const handleSpeedChange = (speed: string) => {
    const duration = ZOOM.SPEED_OPTIONS[speed as keyof typeof ZOOM.SPEED_OPTIONS]
    updateRegion(region.id, { transitionDuration: duration })
  }

  const handleEasingChange = (easing: string) => {
    updateRegion(region.id, { easing })
  }

  const handleZoomLevelChange = (value: number) => {
    updateRegion(region.id, { zoomLevel: value })
  }

  const handleResetAnimation = () => {
    updateRegion(region.id, {
      transitionDuration: ZOOM.SPEED_OPTIONS[DEFAULTS.ANIMATION.SPEED.defaultValue as keyof typeof ZOOM.SPEED_OPTIONS],
      easing: DEFAULTS.ANIMATION.EASING.defaultValue,
      zoomLevel: DEFAULTS.ANIMATION.ZOOM_LEVEL.defaultValue,
    })
  }

  const currentSpeed =
    speedOptions.find(
      (speed) => ZOOM.SPEED_OPTIONS[speed as keyof typeof ZOOM.SPEED_OPTIONS] === region.transitionDuration,
    ) || ZOOM.DEFAULT_SPEED

  return (
    <Section
      label="Animation"
      labelRight={
        <Button variant="ghost" size="sm" onClick={handleResetAnimation} aria-label="Reset animation">
          Reset
        </Button>
      }
    >
      <div className="space-y-3.5">
        <div className="space-y-2">
          <SectionLabel>Speed</SectionLabel>
          <SegmentedControl
            aria-label="Speed"
            options={speedOptions.map((speed) => ({ value: speed, label: speed }))}
            value={currentSpeed}
            onChange={handleSpeedChange}
          />
        </div>

        <div className="space-y-2">
          <SectionLabel>Easing</SectionLabel>
          <Select value={region.easing} onValueChange={handleEasingChange}>
            <SelectTrigger aria-label="Easing">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {easingOptions.map((easing) => (
                <SelectItem key={easing} value={easing}>
                  {easing}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Slider
          label="Zoom level"
          min={DEFAULTS.ANIMATION.ZOOM_LEVEL.min}
          max={DEFAULTS.ANIMATION.ZOOM_LEVEL.max}
          step={DEFAULTS.ANIMATION.ZOOM_LEVEL.step}
          value={region.zoomLevel}
          onChange={handleZoomLevelChange}
          formatValue={(value) => `${value.toFixed(1)}\u00d7`}
        />
      </div>
    </Section>
  )
}
