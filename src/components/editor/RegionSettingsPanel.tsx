// Inspector for a selected timeline region (zoom and cut).
// Flat Sections on the shared primitives (DESIGN_SPEC §10).
import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { TimelineRegion, ZoomRegion, SpeedRegion } from '../../types'
import { Button } from '../ui/button'
import { HelperText } from '../ui/helper-text'
import { Section } from '../ui/section'
import { SegmentedControl } from '../ui/segmented-control'
import { Slider } from '../ui/slider'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { Pointer, Video, Trash } from 'tabler-icons-react'
import { PanelHeader } from './PanelHeader'
import { FocusPointPicker } from './sidepanel/FocusPointPicker'
import { AnimationSettings } from './sidepanel/AnimationSettings'

interface RegionSettingsPanelProps {
  region: TimelineRegion
}

function ZoomSettings({ region }: { region: ZoomRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()

  const [activeTab, setActiveTab] = useState(region.mode)

  const handleModeChange = (newMode: 'auto' | 'fixed') => {
    setActiveTab(newMode)
    updateRegion(region.id, { mode: newMode })
  }

  return (
    <>
      <Section first label="Zoom type">
        <SegmentedControl
          aria-label="Zoom type"
          options={[
            {
              value: 'auto',
              label: (
                <>
                  <Pointer size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  Auto
                </>
              ),
            },
            {
              value: 'fixed',
              label: (
                <>
                  <Video size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  Fixed
                </>
              ),
            },
          ]}
          value={activeTab}
          onChange={handleModeChange}
        />
        {activeTab === 'auto' && <HelperText>Zoom will automatically follow the mouse cursor in this area.</HelperText>}
      </Section>

      {activeTab === 'fixed' && (
        <FocusPointPicker
          regionId={region.id}
          targetX={region.targetX}
          targetY={region.targetY}
          startTime={region.startTime}
          onTargetChange={({ x, y }) => updateRegion(region.id, { targetX: x, targetY: y })}
        />
      )}

      <AnimationSettings region={region} />

      <Section>
        <Button variant="danger" className="w-full" onClick={() => deleteRegion(region.id)}>
          <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
          Delete region
        </Button>
      </Section>
    </>
  )
}

/**
 * A speed region: how fast, and for how long.
 *
 * The speed is capped at 4x because that is what the export can render — `atempo`
 * takes one factor between 0.5 and 2 and is chained beyond that — and a region that
 * asks for more would be silently clamped at export time, which is worse than not
 * offering it.
 */
function SpeedSettings({ region }: { region: SpeedRegion }) {
  const { updateRegion, deleteRegion } = useEditorStore.getState()

  return (
    <>
      <Section first label="Playback speed">
        <Slider
          label="Speed"
          min={0.5}
          max={4}
          step={0.1}
          value={region.speed}
          formatValue={(value) => `${value.toFixed(1)}×`}
          onChange={(speed) => updateRegion(region.id, { speed })}
        />
        <HelperText>
          The audio is sped up with the picture, so nothing drifts out of step. Captions move with it.
        </HelperText>
      </Section>

      <Section label="Length">
        <Slider
          label="On screen for"
          min={0.2}
          max={Math.max(0.2, region.duration)}
          step={0.1}
          value={region.duration}
          formatValue={(value) => `${value.toFixed(1)}s`}
          onChange={(duration) => updateRegion(region.id, { duration })}
        />
      </Section>

      <Section>
        <Button variant="danger" className="w-full" onClick={() => deleteRegion(region.id)}>
          <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
          Delete region
        </Button>
      </Section>
    </>
  )
}

export function RegionSettingsPanel({ region }: RegionSettingsPanelProps) {
  const heading =
    region.type === 'zoom'
      ? { title: 'Zoom region', subtitle: 'Zoom and pan controls' }
      : region.type === 'speed'
        ? { title: 'Speed region', subtitle: 'How fast this stretch plays' }
        : { title: 'Cut region', subtitle: 'Cut segment settings' }

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={heading.title} subtitle={heading.subtitle} />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        {region.type === 'zoom' && <ZoomSettings region={region} />}

        {/* A speed region used to fall through to the cut panel, which told the user
            their sped-up stretch would be removed from the final video. */}
        {region.type === 'speed' && <SpeedSettings region={region} />}

        {region.type === 'cut' && (
          <Section first label="Cut segment">
            <HelperText className="mt-0">This portion will be removed from the final video.</HelperText>
          </Section>
        )}
      </div>
    </div>
  )
}
