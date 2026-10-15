import { useEffect, useRef, useState, useCallback } from 'react'
import { useEditorStore } from '../store/editorStore'
import { Preview } from '../components/editor/Preview'
import { SidePanel } from '../components/editor/SidePanel'
import { Timeline } from '../components/editor/Timeline'
import { PreviewControls } from '../components/editor/PreviewControls'
import { UpdateNotification } from '../components/editor/UpdateNotification'
import { ExportButton } from '../components/editor/ExportButton'
import { ExportModal } from '../components/editor/ExportModal'
import { WindowControls } from '../components/editor/WindowControls'
import { SaveStatusIndicator } from '../components/editor/SaveStatusIndicator'
import { ProjectMenu } from '../components/editor/ProjectMenu'
import { ToastViewport } from '../components/ui/toast'
import { PresetModal } from '../components/editor/PresetModal'
import { SettingsModal } from '../components/settings/SettingsModal'
import { Stack3, Loader2, Check, Settings } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../components/ui/icons'
import { cn, formatTime } from '../lib/utils'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useAutoSave } from '../hooks/useAutoSave'
import { useExportProcess } from '../hooks/useExportProcess'
import { Button } from '../components/ui/button'
import { useShallow } from 'zustand/react/shallow'

export function EditorPage() {
  const {
    loadProject,
    deleteRegion,
    initializePresets,
    initializeSettings,
    initializeRecentProjects,
    rememberRecentProject,
    forgetRecentProject,
    pushToast,
    applyOpenedProject,
    saveProject,
    saveProjectCopy,
    renameCurrentProject,
    togglePlay,
    togglePreviewFullScreen,
    seekToNextFrame,
    seekToPreviousFrame,
    seekBackward,
    seekForward,
  } = useEditorStore.getState()
  const { presetSaveStatus, duration, isPreviewFullScreen, videoDimensions, currentProjectPath } = useEditorStore(
    useShallow((state) => ({
      presetSaveStatus: state.presetSaveStatus,
      duration: state.duration,
      isPreviewFullScreen: state.isPreviewFullScreen,
      videoDimensions: state.videoDimensions,
      currentProjectPath: state.currentProjectPath,
    })),
  )
  // Top-bar meta (DESIGN_SPEC §5 shows "project | timecode · resolution"). Display only.
  const metaLabel =
    duration > 0 && videoDimensions.width > 0
      ? `${formatTime(duration, true)} · ${videoDimensions.width}\u00d7${videoDimensions.height}`
      : null
  const { undo, redo } = useEditorStore.temporal.getState()
  const {
    isModalOpen: isExportModalOpen,
    isExporting,
    progress: exportProgress,
    result: exportResult,
    openExportModal: openExportModalBase,
    closeExportModal,
    startExport,
    cancelExport,
  } = useExportProcess()

  // Saves in the background while the project has unsaved changes.
  useAutoSave()

  const videoRef = useRef<HTMLVideoElement>(null)
  const [isExportMinimized, setExportMinimized] = useState(false)
  const [isPresetModalOpen, setPresetModalOpen] = useState(false)
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null)
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)
  const openExportModal = () => {
    setExportMinimized(false)
    openExportModalBase()
  }
  useEffect(() => {
    if (!isExporting) setExportMinimized(false)
  }, [isExporting])

  const handleDeleteSelectedRegion = useCallback(() => {
    const currentSelectedId = useEditorStore.getState().selectedRegionId
    if (currentSelectedId) {
      deleteRegion(currentSelectedId)
    }
  }, [deleteRegion])

  const handleSeekFrame = useCallback(
    (direction: 'next' | 'prev') => {
      if (direction === 'next') {
        seekToNextFrame()
      } else {
        seekToPreviousFrame()
      }
      if (videoRef.current) {
        videoRef.current.currentTime = useEditorStore.getState().currentTime
      }
    },
    [seekToNextFrame, seekToPreviousFrame],
  )

  const handleSeekByTime = useCallback(
    (seconds: number) => {
      if (seconds > 0) {
        seekForward(seconds)
      } else {
        seekBackward(Math.abs(seconds))
      }
      if (videoRef.current) {
        videoRef.current.currentTime = useEditorStore.getState().currentTime
      }
    },
    [seekForward, seekBackward],
  )

  /** Opens a project, optionally one the user picked from Open recent. */
  const openProject = useCallback(
    async (path?: string) => {
      const result = await window.electronAPI.openProjectFile(path ? { path, quiet: true } : undefined)
      if (result.canceled) {
        if (path && result.missing) {
          // The remembered file has gone: say so quietly and forget it.
          forgetRecentProject(path)
          pushToast({ message: "That project can't be found" })
        }
        return
      }
      if (!result.project) return
      await applyOpenedProject(result.project as Record<string, unknown>, result.projectPath ?? '')
      useEditorStore.temporal.getState().clear()
    },
    [applyOpenedProject, forgetRecentProject, pushToast],
  )

  const handleSaveNow = useCallback(async () => {
    await saveProject()
  }, [saveProject])

  /** Writes a snapshot elsewhere; the edited project stays where it is. */
  const handleSaveCopy = useCallback(async () => {
    const result = await saveProjectCopy()
    if (result.canceled || !result.path) {
      if (result.error) pushToast({ message: `Couldn't save the copy: ${result.error}` })
      return
    }
    const fileName = result.path.split(/[\\/]/).pop() ?? result.path
    pushToast({ message: `Copy saved as ${fileName}`, actionLabel: 'Open', revealPath: result.path })
  }, [saveProjectCopy, pushToast])

  const handleRename = useCallback(async (newName: string) => renameCurrentProject(newName), [renameCurrentProject])

  /**
   * Commands from the native File menu. Both the menu and the keyboard route
   * through the same handlers as the project menu's items.
   */
  const handleMenuCommand = useCallback(
    async (command: 'save' | 'save-copy' | 'open') => {
      if (command === 'open') {
        await openProject()
        return
      }
      if (command === 'save') {
        await handleSaveNow()
        return
      }
      await handleSaveCopy()
    },
    [openProject, handleSaveNow, handleSaveCopy],
  )

  const handleShowInFolder = useCallback(() => {
    const path = useEditorStore.getState().currentProjectPath
    if (path) window.electronAPI.showItemInFolder(path)
  }, [])

  const handleNewRecording = useCallback(() => {
    window.electronAPI.showRecorderWindow()
  }, [])

  // Every project that gets a path (opened, saved, renamed) is remembered.
  useEffect(() => {
    if (currentProjectPath) rememberRecentProject(currentProjectPath)
  }, [currentProjectPath, rememberRecentProject])

  useKeyboardShortcuts(
    {
      delete: handleDeleteSelectedRegion,
      backspace: handleDeleteSelectedRegion,
      ' ': (e) => {
        e.preventDefault()
        togglePlay()
      },
      j: () => handleSeekFrame('prev'),
      k: () => handleSeekFrame('next'),
      arrowleft: () => handleSeekByTime(-1),
      arrowright: () => handleSeekByTime(1),
      f: () => togglePreviewFullScreen(),
      'ctrl+s': (e) => {
        e.preventDefault()
        void handleMenuCommand('save')
      },
      'ctrl+z': (e) => {
        e.preventDefault()
        undo()
      },
      'ctrl+y': (e) => {
        e.preventDefault()
        redo()
      },
      'ctrl+shift+z': (e) => {
        e.preventDefault()
        redo()
      },
    },
    [handleDeleteSelectedRegion, undo, redo, togglePlay, handleSeekFrame, togglePreviewFullScreen, handleMenuCommand],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isPreviewFullScreen) {
        togglePreviewFullScreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPreviewFullScreen, togglePreviewFullScreen])

  useEffect(() => {
    const cleanup = window.electronAPI.onUpdateAvailable((info: { version: string; url: string }) => {
      setUpdateInfo(info)
    })
    return () => cleanup()
  }, [])

  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform)
    initializeSettings()
    void initializeRecentProjects()
    const cleanup = window.electronAPI.onProjectOpen(async (payload) => {
      await initializePresets()
      await loadProject(payload)
      useEditorStore.temporal.getState().clear()
    })
    return () => cleanup()
  }, [loadProject, initializePresets, initializeSettings, initializeRecentProjects])

  useEffect(() => {
    const cleanupMenu = window.electronAPI.onMenuCommand((command) => {
      void handleMenuCommand(command)
    })
    // Projects opened from the OS (file association / CLI) arrive here.
    const cleanupApply = window.electronAPI.onProjectApply(async (payload) => {
      await applyOpenedProject(payload.project as Record<string, unknown>, payload.projectPath)
      useEditorStore.temporal.getState().clear()
    })
    return () => {
      cleanupMenu()
      cleanupApply()
    }
  }, [handleMenuCommand, applyOpenedProject])

  const getPresetButtonContent = () => {
    switch (presetSaveStatus) {
      case 'saving':
        return (
          <>
            <Loader2 className="mr-2 animate-spin" size={ICON_SIZE} strokeWidth={ICON_STROKE} /> Saving...
          </>
        )
      case 'saved':
        return (
          <>
            <Check className="mr-2" size={ICON_SIZE} strokeWidth={ICON_STROKE} /> Saved!
          </>
        )
      default:
        return (
          <>
            <Stack3 className="mr-2" size={ICON_SIZE} strokeWidth={ICON_STROKE} /> Presets
          </>
        )
    }
  }

  const renderHeaderActions = () => {
    const isWindows = platform === 'win32'
    const actions = [
      <ExportButton key="export" isExporting={isExporting} onClick={openExportModal} disabled={duration <= 0} />,
      <Button
        key="presets"
        variant="secondary"
        size="sm"
        onClick={() => setPresetModalOpen(true)}
        disabled={presetSaveStatus === 'saving'}
        className={cn(
          'transition-all duration-300 w-[110px] h-8 font-medium shadow-sm',
          presetSaveStatus === 'saved' && 'bg-accent/15 border border-accent/30',
          'text-accent shadow-accent/10',
        )}
      >
        {getPresetButtonContent()}
      </Button>,
      <Button
        key="settings"
        variant="ghost"
        size="icon"
        onClick={() => setSettingsModalOpen(true)}
        aria-label="Open Settings"
        className={cn('h-8 w-8 rounded-ctl text-muted hover:bg-ctl hover:text-fg')}
      >
        <Settings size={ICON_SIZE} strokeWidth={ICON_STROKE} />
      </Button>,
      updateInfo && <UpdateNotification key="update" info={updateInfo} />,
    ].filter(Boolean)

    if (isWindows) {
      // For Windows, reverse the order
      return actions
    }
    // For macOS/Linux, keep original order but reverse for flex-row-reverse
    return actions.reverse()
  }

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-app select-none">
      {/*
        Instead of conditionally rendering the entire layout, we now render it once
        and use CSS classes to hide/show elements and expand the preview for fullscreen.
        This prevents components like SidePanel from unmounting, preserving their internal state.
      */}
      <header
        className={cn(
          'relative flex h-11 flex-shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-3',
          isPreviewFullScreen && 'hidden', // Hide header in fullscreen
        )}
        style={{ WebkitAppRegion: 'drag' }}
      >
        {/* Left: window controls (Linux) / actions (Windows), then the app wordmark */}
        <div className="flex min-w-0 items-center gap-3">
          {platform === 'linux' && (
            <div className="flex h-full items-center">
              <WindowControls />
            </div>
          )}
          {platform === 'win32' && (
            <div
              className="flex flex-row-reverse items-center gap-2" // Use flex-row-reverse to get desired order
              style={{ WebkitAppRegion: 'no-drag' }}
            >
              {renderHeaderActions()}
            </div>
          )}
          <div className="pointer-events-none flex min-w-0 items-center gap-2 pl-1">
            <ProjectMenu
              onOpenProject={() => void openProject()}
              onOpenRecent={(path) => void openProject(path)}
              onSave={() => void handleSaveNow()}
              onSaveCopy={() => void handleSaveCopy()}
              onRename={handleRename}
              onShowInFolder={handleShowInFolder}
              onNewRecording={handleNewRecording}
            />
            {metaLabel && <span className="truncate font-mono text-sm text-muted">{metaLabel}</span>}
            <SaveStatusIndicator />
          </div>
        </div>

        {/* Right side controls (for non-Windows) */}
        {platform !== 'win32' && (
          <div
            className="flex items-center gap-2" // Use flex-row-reverse to get desired order
            style={{ WebkitAppRegion: 'no-drag' }}
          >
            {renderHeaderActions()}
          </div>
        )}
      </header>

      <div className={cn('flex flex-1 overflow-hidden', isPreviewFullScreen && 'h-full w-full')}>
        <div
          className={cn(
            'w-[312px] flex-shrink-0 overflow-hidden border-r border-line bg-panel',
            isPreviewFullScreen && 'hidden', // Hide SidePanel in fullscreen
          )}
        >
          <SidePanel />
        </div>
        <div className="flex flex-1 flex-col overflow-hidden bg-stage">
          <div
            className={cn(
              'flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6',
              // Make the preview container expand to fill the screen in fullscreen mode
              isPreviewFullScreen && 'fixed inset-0 z-50 bg-black p-0',
            )}
          >
            <Preview videoRef={videoRef} onSeekFrame={handleSeekFrame} />
          </div>
          <div className={cn('flex-shrink-0', isPreviewFullScreen && 'hidden')}>
            <PreviewControls />
          </div>
          <div
            className={cn(
              'flex-shrink-0 overflow-hidden border-t border-line bg-panel',
              isPreviewFullScreen && 'hidden', // Hide Timeline in fullscreen
            )}
          >
            <Timeline videoRef={videoRef} />
          </div>
        </div>
      </div>

      {isExporting && isExportMinimized && (
        <button
          type="button"
          onClick={() => {
            setExportMinimized(false)
            openExportModal()
          }}
          title={`Export progress: ${Math.round(exportProgress)}% — click to expand`}
          className="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel text-fg shadow-[var(--sa-popover-shadow)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {/* Accent progress stroke on a ctl track (DESIGN_SPEC §5). */}
          <svg className="absolute inset-0 h-12 w-12 -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r="24" fill="none" stroke="var(--sa-ctl)" strokeWidth="4" />
            <circle
              cx="28"
              cy="28"
              r="24"
              fill="none"
              stroke="var(--sa-accent)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 24}
              strokeDashoffset={2 * Math.PI * 24 * (1 - exportProgress / 100)}
            />
          </svg>
          <span className="relative font-mono text-sm">{Math.round(exportProgress)}%</span>
        </button>
      )}
      <ExportModal
        isOpen={isExportModalOpen && !isExportMinimized}
        onClose={() => {
          closeExportModal()
          setExportMinimized(false)
        }}
        onMinimize={() => setExportMinimized(true)}
        onStartExport={startExport}
        onCancelExport={cancelExport}
        isExporting={isExporting}
        progress={exportProgress}
        result={exportResult}
      />
      <PresetModal isOpen={isPresetModalOpen} onClose={() => setPresetModalOpen(false)} />
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
      {/* Kept clear of the minimised-export bubble in the same corner. */}
      <ToastViewport className={isExporting && isExportMinimized ? 'bottom-20' : 'bottom-5'} />
    </main>
  )
}
