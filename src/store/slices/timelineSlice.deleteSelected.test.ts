// deleteSelected: whatever carries the editor's selection is removed by one
// action, which backs both the Delete/Backspace key and the trash button.
import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '../editorStore'

type State = ReturnType<typeof useEditorStore.getState>

const clearState = () => {
  useEditorStore.setState({
    selectedRegionId: null,
    zoomRegions: {},
    cutRegions: {},
    speedRegions: {},
    visualEffects: [],
    videoClips: [],
    audioClips: [],
    compositionLayouts: [],
    cameraMotions: [],
  })
}

beforeEach(clearState)

describe('deleteSelected', () => {
  it('deletes a zoom region (map-backed) and clears the selection', () => {
    useEditorStore.setState({
      zoomRegions: { 'zoom-1': { id: 'zoom-1', type: 'zoom', startTime: 1, duration: 2 } },
    } as unknown as State)
    useEditorStore.getState().setSelectedRegionId('zoom-1')
    useEditorStore.getState().deleteSelected()
    const s = useEditorStore.getState()
    expect(s.zoomRegions['zoom-1']).toBeUndefined()
    expect(s.selectedRegionId).toBeNull()
    expect(Object.keys(s.zoomRegions)).toHaveLength(0)
  })

  it('deletes a visual effect by id', () => {
    useEditorStore.setState({
      visualEffects: [{ id: 'fx-1', kind: 'blur', startTime: 0, duration: 3 }],
    } as unknown as State)
    useEditorStore.getState().setSelectedRegionId('fx-1')
    useEditorStore.getState().deleteSelected()
    expect(useEditorStore.getState().visualEffects.some((e) => e.id === 'fx-1')).toBe(false)
    expect(useEditorStore.getState().selectedRegionId).toBeNull()
  })

  it('deletes a video clip', () => {
    useEditorStore.setState({
      videoClips: [{ id: 'clip-v', filePath: '/x.mp4', startTime: 0, duration: 5 }],
    } as unknown as State)
    useEditorStore.getState().setSelectedRegionId('clip-v')
    useEditorStore.getState().deleteSelected()
    expect(useEditorStore.getState().videoClips.some((c) => c.id === 'clip-v')).toBe(false)
    expect(useEditorStore.getState().selectedRegionId).toBeNull()
  })

  it('deletes an audio clip', () => {
    useEditorStore.setState({
      audioClips: [{ id: 'clip-a', filePath: '/x.mp3', startTime: 0, duration: 4 }],
    } as unknown as State)
    useEditorStore.getState().setSelectedRegionId('clip-a')
    useEditorStore.getState().deleteSelected()
    expect(useEditorStore.getState().audioClips.some((c) => c.id === 'clip-a')).toBe(false)
    expect(useEditorStore.getState().selectedRegionId).toBeNull()
  })

  it('deletes a composition layout', () => {
    useEditorStore.setState({
      compositionLayouts: [{ id: 'layout-1', layout: 'split', startTime: 0, duration: 4 }],
    } as unknown as State)
    useEditorStore.getState().setSelectedRegionId('layout-1')
    useEditorStore.getState().deleteSelected()
    expect(useEditorStore.getState().compositionLayouts.some((l) => l.id === 'layout-1')).toBe(false)
    expect(useEditorStore.getState().selectedRegionId).toBeNull()
  })

  it('deletes a camera motion', () => {
    useEditorStore.setState({
      cameraMotions: [{ id: 'motion-1', kind: 'pan', startTime: 0, duration: 4 }],
    } as unknown as State)
    useEditorStore.getState().setSelectedRegionId('motion-1')
    useEditorStore.getState().deleteSelected()
    expect(useEditorStore.getState().cameraMotions.some((m) => m.id === 'motion-1')).toBe(false)
    expect(useEditorStore.getState().selectedRegionId).toBeNull()
  })

  it('only affects the selected item type', () => {
    useEditorStore.setState({
      zoomRegions: { 'zoom-1': { id: 'zoom-1', type: 'zoom', startTime: 1, duration: 2 } },
      visualEffects: [{ id: 'fx-1', kind: 'blur', startTime: 0, duration: 3 }],
    } as unknown as State)
    useEditorStore.getState().setSelectedRegionId('fx-1')
    useEditorStore.getState().deleteSelected()
    const s = useEditorStore.getState()
    expect(s.visualEffects).toHaveLength(0)
    expect(s.zoomRegions['zoom-1']).toBeDefined()
  })

  it('does nothing when nothing is selected', () => {
    expect(() => useEditorStore.getState().deleteSelected()).not.toThrow()
  })
})
