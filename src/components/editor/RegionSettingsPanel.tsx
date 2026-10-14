// Inspector for a selected timeline region (zoom and cut).
// Flat Sections on the shared primitives (DESIGN_SPEC §10).
import { useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import type { TimelineRegion, ZoomRegion } from '../../types'
import { Button } from '../ui/button'
import { HelperText } from '../ui/helper-text'
import { Section } from '../ui/section'
import { SegmentedControl } from '../ui/segmented-control'
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
            { value: 'auto', label: <><Pointer size={ICON_SIZE} strokeWidth={ICON_STROKE} />Auto</> },
            { value: 'fixed', label: <><Video size={ICON_SIZE} strokeWidth={ICON_STROKE} />Fixed</> },
          ]}
          value={activeTab}
          onChange={handleModeChange}
        />
        {activeTab === 'auto' && (
          <HelperText>Zoom will automatically follow the mouse cursor in this area.</HelperText>
        )}
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

export function RegionSettingsPanel({ region }: RegionSettingsPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title={`${region.type === 'zoom' ? 'Zoom' : 'Cut'} region`}
        subtitle={region.type === 'zoom' ? 'Zoom and pan controls' : 'Cut segment settings'}
      />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        {region.type === 'zoom' && <ZoomSettings region={region} />}

        {region.type === 'cut' && (
          <Section first label="Cut segment">
            <HelperText className="mt-0">This portion will be removed from the final video.</HelperText>
          </Section>
        )}
      </div>
    </div>
  )
}
