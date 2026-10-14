import { useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useEditorStore } from '../../store/editorStore'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { PresetPreview } from './PresetPreview'
import type { Preset } from '../../types'
import { cn } from '../../lib/utils'
import { ICON_SIZE, ICON_STROKE } from '../ui/icons'
import { PanelHeader } from './PanelHeader'
import { Plus, Trash, Check, Lock, Rectangle, BoxPadding, BorderRadius, Shadow, BorderAll } from 'tabler-icons-react'

interface PresetModalProps {
  isOpen: boolean
  onClose: () => void
}

export function PresetModal({ isOpen, onClose }: PresetModalProps) {
  const { presets, activePresetId, applyPreset, saveCurrentStyleAsPreset, deletePreset, updatePresetName } =
    useEditorStore(
      useShallow((state) => ({
        presets: state.presets,
        activePresetId: state.activePresetId,
        applyPreset: state.applyPreset,
        saveCurrentStyleAsPreset: state.saveCurrentStyleAsPreset,
        deletePreset: state.deletePreset,
        updatePresetName: state.updatePresetName,
      })),
    )

  const [previewId, setPreviewId] = useState<string | null>(activePresetId)
  const [newPresetName, setNewPresetName] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  // Reset previewId when modal is opened or active preset changes
  useEffect(() => {
    if (isOpen) {
      setPreviewId(activePresetId)
    }
  }, [isOpen, activePresetId])

  const defaultPreset = Object.values(presets).find((p) => p.isDefault)

  useEffect(() => {
    if (isOpen && !activePresetId && defaultPreset) {
      setPreviewId(defaultPreset.id)
    }
  }, [isOpen, activePresetId, defaultPreset])

  if (!isOpen) return null

  const presetList = Object.values(presets)
  const previewPreset = previewId ? presets[previewId] : defaultPreset || null

  const handleSaveNew = () => {
    if (newPresetName.trim()) {
      saveCurrentStyleAsPreset(newPresetName.trim())
      setNewPresetName('')
    }
  }

  const handleDoubleClick = (preset: Preset) => {
    if (!preset.isDefault) {
      setEditingId(preset.id)
      setEditingName(preset.name)
    }
  }

  const handleRename = () => {
    if (editingId && editingName.trim()) {
      updatePresetName(editingId, editingName.trim())
    }
    setEditingId(null)
    setEditingName('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingName('')
  }

  const handleSelect = () => {
    if (previewId) {
      applyPreset(previewId)
      onClose()
    }
  }

  const handleDelete = (idToDelete: string) => {
    deletePreset(idToDelete)
    if (previewId === idToDelete) {
      setPreviewId(defaultPreset?.id || null)
    }
  }

  const stats = previewPreset
    ? [
        { icon: <Rectangle size={ICON_SIZE} strokeWidth={ICON_STROKE} />, value: previewPreset.aspectRatio },
        { icon: <BoxPadding size={ICON_SIZE} strokeWidth={ICON_STROKE} />, value: `${previewPreset.styles.padding}%` },
        { icon: <BorderRadius size={ICON_SIZE} strokeWidth={ICON_STROKE} />, value: `${previewPreset.styles.borderRadius}px` },
        { icon: <Shadow size={ICON_SIZE} strokeWidth={ICON_STROKE} />, value: `${previewPreset.styles.shadowBlur}px` },
        { icon: <BorderAll size={ICON_SIZE} strokeWidth={ICON_STROKE} />, value: `${previewPreset.styles.borderWidth}px` },
      ]
    : []

  return (
    <div className="modal-backdrop flex items-center justify-center" onClick={onClose}>
      <div
        className="card-clean m-4 flex h-[85vh] max-h-[800px] w-full max-w-5xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <PanelHeader title="Manage presets" subtitle="Select, create, or delete your frame style presets." />

        <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
          {/* Preset list */}
          <div className="flex w-1/3 flex-col border-r border-line p-4">
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto stable-scrollbar">
              {presetList.map((p) =>
                editingId === p.id ? (
                  <div key={p.id} className="py-0.5">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename()
                        if (e.key === 'Escape') cancelRename()
                      }}
                      autoFocus
                      aria-label="Preset name"
                    />
                  </div>
                ) : (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPreviewId(p.id)}
                    onDoubleClick={() => handleDoubleClick(p)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-ctl border-l-2 px-3 py-2 text-left text-ui transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                      previewId === p.id
                        ? 'border-accent bg-ctl text-fg'
                        : 'border-transparent text-fg hover:bg-ctl',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate">{p.name}</span>
                      {p.isDefault && <Lock size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />}
                    </span>
                    {activePresetId === p.id && <Check size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-accent" />}
                  </button>
                ),
              )}
            </div>
            <div className="mt-3 space-y-2 border-t border-line pt-3">
              <Input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="New preset name…"
                aria-label="New preset name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newPresetName.trim()) handleSaveNew()
                }}
              />
              <Button className="w-full" onClick={handleSaveNew} disabled={!newPresetName.trim()}>
                <Plus size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                Save current style
              </Button>
            </div>
          </div>

          {/* Preview */}
          <div className="flex w-2/3 flex-col bg-app p-5">
            {previewPreset ? (
              <div className="flex h-full w-full min-h-0 flex-col">
                <div className="mb-4 flex flex-shrink-0 items-center justify-between gap-3">
                  <h3 className="flex min-w-0 items-center gap-2 text-title font-semibold text-fg">
                    <span className="truncate">{previewPreset.name}</span>
                    {previewPreset.isDefault && <Lock size={ICON_SIZE} strokeWidth={ICON_STROKE} className="shrink-0 text-muted" />}
                  </h3>
                  {!previewPreset.isDefault && (
                    <Button variant="danger" size="sm" onClick={() => handleDelete(previewPreset.id)}>
                      <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                      Delete
                    </Button>
                  )}
                </div>

                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <PresetPreview
                    styles={previewPreset.styles}
                    aspectRatio={previewPreset.aspectRatio}
                    isWebcamVisible={previewPreset.isWebcamVisible}
                    webcamPosition={previewPreset.webcamPosition}
                    webcamStyles={previewPreset.webcamStyles}
                  />
                </div>

                <div className="mt-4 flex flex-shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-line pt-4">
                  {stats.map((stat) => (
                    <span key={stat.value} className="flex items-center gap-1.5 text-sm text-muted">
                      {stat.icon}
                      <span className="font-mono tabular-nums">{stat.value}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted">Select a preset to preview</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-line p-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!previewId}>
            Select preset
          </Button>
        </div>
      </div>
    </div>
  )
}
