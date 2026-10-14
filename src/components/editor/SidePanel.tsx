import { useEditorStore } from '../../store/editorStore'
import { RegionSettingsPanel } from './RegionSettingsPanel'
import type { SidePanelTab } from '../../types'
import { BackgroundSettings } from './sidepanel/BackgroundSettings'
import { FrameEffectsSettings } from './sidepanel/FrameEffectsSettings'
import { CameraSettings } from './sidepanel/CameraSettings'
import { CursorSettings } from './sidepanel/CursorSettings'
import { AnimationSettingsPanel } from './sidepanel/AnimationSettingsPanel'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '../../lib/utils'
import { AudioSettings } from './sidepanel/AudioSettings'
import { CameraMotionSettings } from './sidepanel/CameraMotionSettings'
import { CompositionLayoutSettings } from './sidepanel/CompositionLayoutSettings'
import { VisualEffectsSettings } from './sidepanel/VisualEffectsSettings'
import { PanelHeader } from './PanelHeader'

/**
 * Inspector destinations. The store values are unchanged from the icon rail
 * (general/camera/audio/animation/cursor) — only the labels and the presentation
 * changed. DESIGN_SPEC §5: text tabs, 13px, 12px 8px padding, active = text colour
 * + 2px accent underline, hairline under the strip.
 */
const TABS: { id: SidePanelTab; label: string }[] = [
  { id: 'general', label: 'Layout' },
  { id: 'camera', label: 'Camera' },
  { id: 'audio', label: 'Audio' },
  { id: 'animation', label: 'Motion' },
  { id: 'cursor', label: 'Cursor' },
]

function FrameSettingsPanel() {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Layout" subtitle="Background, spacing and depth" />
      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        {/* Sections carry their own padding + hairline dividers (flat, no wrappers). */}
        <BackgroundSettings />
        <FrameEffectsSettings />
        <VisualEffectsSettings />
      </div>
    </div>
  )
}

export function SidePanel() {
  // Get necessary states from the store
  const {
    selectedRegionId,
    zoomRegions,
    cutRegions,
    cameraMotions,
    compositionLayouts,
    audioClips,
    deleteAudioClip,
    webcamVideoUrl,
    setSelectedRegionId,
    deleteCameraMotion,
    deleteCompositionLayout,
    activeSidePanelTab,
    setActiveSidePanelTab,
  } = useEditorStore(
    useShallow((state) => ({
      selectedRegionId: state.selectedRegionId,
      zoomRegions: state.zoomRegions,
      cutRegions: state.cutRegions,
      cameraMotions: state.cameraMotions,
      compositionLayouts: state.compositionLayouts,
      audioClips: state.audioClips,
      deleteAudioClip: state.deleteAudioClip,
      webcamVideoUrl: state.webcamVideoUrl,
      setSelectedRegionId: state.setSelectedRegionId,
      deleteCameraMotion: state.deleteCameraMotion,
      deleteCompositionLayout: state.deleteCompositionLayout,
      activeSidePanelTab: state.activeSidePanelTab,
      setActiveSidePanelTab: state.setActiveSidePanelTab,
    })),
  )

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const isTabDisabled = (id: SidePanelTab) => id === 'camera' && !webcamVideoUrl

  // Roving tabindex: arrows move between enabled tabs, Home/End jump to the ends.
  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    const isHome = event.key === 'Home'
    const isEnd = event.key === 'End'
    if (!forward && !backward && !isHome && !isEnd) return

    event.preventDefault()
    const enabled = TABS.map((tab, i) => ({ tab, i })).filter(({ tab }) => !isTabDisabled(tab.id))
    if (enabled.length === 0) return

    let target = enabled.find(({ i }) => i === index) ?? enabled[0]
    if (isHome) {
      target = enabled[0]
    } else if (isEnd) {
      target = enabled[enabled.length - 1]
    } else if (forward || backward) {
      const position = enabled.findIndex(({ i }) => i === index)
      if (position !== -1) {
        const next = (position + (forward ? 1 : -1) + enabled.length) % enabled.length
        target = enabled[next]
      }
    }

    setActiveSidePanelTab(target.tab.id)
    tabRefs.current[target.i]?.focus()
  }

  // Optimize region lookup using useMemo
  const selectedCameraMotion = useMemo(() => cameraMotions.find((motion) => motion.id === selectedRegionId) ?? null, [cameraMotions, selectedRegionId])
  const selectedCompositionLayout = useMemo(() => compositionLayouts.find((range) => range.id === selectedRegionId) ?? null, [compositionLayouts, selectedRegionId])
  const selectedAudioClip = useMemo(() => audioClips.find((clip) => clip.id === selectedRegionId) ?? null, [audioClips, selectedRegionId])
  const selectedVisualEffect = useEditorStore((state) => state.visualEffects.some((effect) => effect.id === selectedRegionId))

  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null
    return zoomRegions[selectedRegionId] || cutRegions[selectedRegionId]
  }, [selectedRegionId, zoomRegions, cutRegions])

  // Auto switch to the panel that owns the current selection.
  useEffect(() => {
    if (selectedAudioClip) {
      setActiveSidePanelTab('audio')
    } else if (selectedRegion || selectedCameraMotion || selectedCompositionLayout || selectedVisualEffect) {
      setActiveSidePanelTab('general')
    }
  }, [selectedRegion, selectedCameraMotion, selectedCompositionLayout, selectedAudioClip, selectedVisualEffect, setActiveSidePanelTab])

  // Handle Escape key to clear selection
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedRegionId) {
        setSelectedRegionId(null)
        return
      }
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || !selectedRegionId) return
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (audioClips.some((clip) => clip.id === selectedRegionId)) {
        event.preventDefault()
        event.stopPropagation()
        deleteAudioClip(selectedRegionId)
        setSelectedRegionId(null)
        return
      }
      if (compositionLayouts.some((range) => range.id === selectedRegionId)) {
        event.preventDefault()
        deleteCompositionLayout(selectedRegionId)
        setSelectedRegionId(null)
        return
      }
      if (!cameraMotions.some((motion) => motion.id === selectedRegionId)) return
      event.preventDefault()
      deleteCameraMotion(selectedRegionId)
      setSelectedRegionId(null)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [selectedRegionId, cameraMotions, compositionLayouts, audioClips, deleteAudioClip, deleteCameraMotion, deleteCompositionLayout, setSelectedRegionId])

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Tab strip (replaces the 64px icon rail) */}
      <div role="tablist" aria-label="Inspector sections" className="flex shrink-0 items-stretch border-b border-line px-2.5">
        {TABS.map((tab, index) => {
          const disabled = isTabDisabled(tab.id)
          const active = activeSidePanelTab === tab.id
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[index] = el
              }}
              type="button"
              role="tab"
              id={`inspector-tab-${tab.id}`}
              aria-controls={`inspector-panel-${tab.id}`}
              aria-selected={active}
              aria-label={tab.label}
              tabIndex={active ? 0 : -1}
              disabled={disabled}
              onClick={() => setActiveSidePanelTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              className={cn(
                'border-b-2 border-transparent px-2 py-3 text-ui transition-colors',
                '-mb-px',
                active ? 'border-accent text-fg' : 'text-muted hover:text-fg',
                disabled && 'cursor-not-allowed opacity-45 hover:text-muted',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Panels are all mounted and toggled with `hidden` so internal state (e.g. an
          open Collapse) survives a tab switch. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          role="tabpanel"
          id="inspector-panel-general"
          aria-labelledby="inspector-tab-general"
          className="h-full"
          hidden={activeSidePanelTab !== 'general'}
        >
          {selectedCompositionLayout ? <CompositionLayoutSettings /> : selectedCameraMotion ? <CameraMotionSettings /> : selectedRegion ? <RegionSettingsPanel region={selectedRegion} /> : <FrameSettingsPanel />}
        </div>
        <div
          role="tabpanel"
          id="inspector-panel-camera"
          aria-labelledby="inspector-tab-camera"
          className="h-full"
          hidden={activeSidePanelTab !== 'camera'}
        >
          <CameraSettings />
        </div>
        <div
          role="tabpanel"
          id="inspector-panel-audio"
          aria-labelledby="inspector-tab-audio"
          className="h-full"
          hidden={activeSidePanelTab !== 'audio'}
        >
          <AudioSettings />
        </div>
        <div
          role="tabpanel"
          id="inspector-panel-animation"
          aria-labelledby="inspector-tab-animation"
          className="h-full"
          hidden={activeSidePanelTab !== 'animation'}
        >
          <AnimationSettingsPanel />
        </div>
        <div
          role="tabpanel"
          id="inspector-panel-cursor"
          aria-labelledby="inspector-tab-cursor"
          className="h-full"
          hidden={activeSidePanelTab !== 'cursor'}
        >
          <CursorSettings />
        </div>
      </div>
    </div>
  )
}
