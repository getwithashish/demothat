import { useEffect, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from 'react'
import { useEditorStore } from '../store/editorStore'
import { Preview } from '../components/editor/Preview'
import { SidePanel } from '../components/editor/SidePanel'
import { Timeline } from '../components/editor/Timeline'
import { PreviewControls } from '../components/editor/PreviewControls'
import { UpdateNotification } from '../components/editor/UpdateNotification'
import { ExportButton } from '../components/editor/ExportButton'
import { ExportModal } from '../components/editor/ExportModal'
import { PublishDialog } from '../components/editor/publish/PublishDialog'
import { SharedLinksDialog } from '../components/editor/publish/SharedLinksDialog'
import { WindowControls } from '../components/editor/WindowControls'
import { SaveStatusIndicator } from '../components/editor/SaveStatusIndicator'
import { ProjectMenu } from '../components/editor/ProjectMenu'
import { ToastViewport } from '../components/ui/toast'
import { PresetModal } from '../components/editor/PresetModal'
import { SettingsModal } from '../components/settings/SettingsModal'
import { CreditCapsule } from '../components/editor/cloud/CreditCapsule'
import { ActivationDialog } from '../components/editor/cloud/ActivationDialog'
import { DevicesDialog } from '../components/editor/cloud/DevicesDialog'
import { BuyCreditsDialog } from '../components/editor/cloud/BuyCreditsDialog'
import { WaitingForPaymentDialog } from '../components/editor/cloud/WaitingForPaymentDialog'
import { ResumeCloudDialog } from '../components/editor/cloud/ResumeCloudDialog'
import { CREDIT_PACKS } from '../../shared/license'
import { pickFirstPurchaseProductId } from '../../shared/pricing'
import { Stack3, Loader2, Check, Settings, Share } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../components/ui/icons'
import { cn, formatTime } from '../lib/utils'
import { projectNameFromPath } from '../lib/recent-projects'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useAutoSave } from '../hooks/useAutoSave'
import { useSessionGuard } from '../hooks/useSessionGuard'
import { useExportProcess } from '../hooks/useExportProcess'
import { usePublish } from '../hooks/usePublish'
import { useLicenseSync } from '../hooks/useLicenseSync'
import { usePurchaseFlow } from '../hooks/usePurchaseFlow'
import { Button } from '../components/ui/button'
import { useShallow } from 'zustand/react/shallow'

export function EditorPage() {
  const {
    loadProject,
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
    openRecoveryCopy,
    togglePlay,
    togglePreviewFullScreen,
    seekToNextFrame,
    seekToPreviousFrame,
    seekBackward,
    seekForward,
  } = useEditorStore.getState()
  const {
    presetSaveStatus,
    duration,
    isPreviewFullScreen,
    videoDimensions,
    currentProjectPath,
    buyCreditsOpen,
    buyCreditsShortfall,
    waitingForPayment,
    subtitleCues,
    balance,
    videoPath,
  } = useEditorStore(
    useShallow((state) => ({
      presetSaveStatus: state.presetSaveStatus,
      duration: state.duration,
      isPreviewFullScreen: state.isPreviewFullScreen,
      videoDimensions: state.videoDimensions,
      currentProjectPath: state.currentProjectPath,
      buyCreditsOpen: state.buyCreditsOpen,
      buyCreditsShortfall: state.buyCreditsShortfall,
      waitingForPayment: state.waitingForPayment,
      subtitleCues: state.subtitleCues,
      balance: state.balance,
      videoPath: state.videoPath,
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
    cloudProgress: exportCloudProgress,
    result: exportResult,
    cloudResumeOffer,
    openExportModal: openExportModalBase,
    closeExportModal,
    startExport,
    cancelExport,
    retryCloud,
    fallbackToStandard,
    resumeCloudWatch,
    dismissCloudResume,
  } = useExportProcess()

  // Publishing: the library, the run in flight, and the terms the server offers.
  const {
    status: publishStatus,
    isPublishing,
    progress: publishProgress,
    publications,
    isLoadingList,
    start: startPublish,
    cancel: cancelPublish,
    loadList: loadPublications,
    remove: removePublication,
    analytics: publicationAnalytics,
  } = usePublish()

  // Saves in the background while the project has unsaved changes.
  useAutoSave()
  // Answers the main process before a session is replaced (open / close / quit).
  useSessionGuard()
  // Plan, balance and devices: refreshed on start and whenever the window regains focus.
  useLicenseSync()
  // Purchases: resumes a pending one, settles the dialogs, counts the credits in.
  usePurchaseFlow({ onDeviceLimitReached: () => setDevicesOpen(true) })

  const videoRef = useRef<HTMLVideoElement>(null)
  const [isExportMinimized, setExportMinimized] = useState(false)
  // Inspector width, draggable like the timeline's height (local state so the
  // two panels keep the same behaviour: it starts at the default each session).
  const [sidebarWidth, setSidebarWidth] = useState(312)
  const beginSidebarResize = useCallback(
    (event: ReactMouseEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const initialWidth = sidebarWidth
      const move = (moveEvent: MouseEvent) => {
        setSidebarWidth(Math.max(240, Math.min(560, initialWidth + (moveEvent.clientX - startX))))
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [sidebarWidth],
  )
  const [isPresetModalOpen, setPresetModalOpen] = useState(false)
  const [isSettingsModalOpen, setSettingsModalOpen] = useState(false)
  const [isActivateOpen, setActivateOpen] = useState(false)
  const [isDevicesOpen, setDevicesOpen] = useState(false)
  const [isPublishOpen, setPublishOpen] = useState(false)
  const [isSharedLinksOpen, setSharedLinksOpen] = useState(false)
  const [publishTarget, setPublishTarget] = useState<{ path: string; sizeBytes: number } | null>(null)
  const [updateInfo, setUpdateInfo] = useState<{ version: string; url: string } | null>(null)
  const [platform, setPlatform] = useState<NodeJS.Platform | null>(null)
  const openExportModal = () => {
    setExportMinimized(false)
    openExportModalBase()
  }
  useEffect(() => {
    if (!isExporting) setExportMinimized(false)
  }, [isExporting])

  // Publishing sends the most recent export when there is one, and otherwise the
  // project's own recording. The size comes from the main process because the renderer
  // cannot stat a file, and the price has to be quoted before anything is uploaded.
  const publishTargetPath = exportResult?.outputPath ?? videoPath ?? null
  useEffect(() => {
    if (publishTargetPath === null) {
      setPublishTarget(null)
      return
    }
    let cancelled = false
    void window.electronAPI.probePublishFile(publishTargetPath).then((result) => {
      if (cancelled) return
      setPublishTarget(result.ok ? { path: publishTargetPath, sizeBytes: result.sizeBytes } : null)
    })
    return () => {
      cancelled = true
    }
  }, [publishTargetPath, isPublishOpen])

  const handleDeleteSelectedRegion = useCallback(() => {
    if (useEditorStore.getState().selectedRegionId) {
      useEditorStore.getState().deleteSelected()
    }
  }, [])

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

  const handleRename = useCallback(
    async (newName: string) => {
      const previousPath = useEditorStore.getState().currentProjectPath
      const result = await renameCurrentProject(newName)
      // The remembered entry still points at the old file name; the path effect
      // adds the new one, so drop the stale entry rather than leaving a dead row.
      if (result.ok && previousPath) forgetRecentProject(previousPath)
      return result
    },
    [renameCurrentProject, forgetRecentProject],
  )

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

  /** Opens the crash copy as an unsaved project, so the first save asks where. */
  const handleOpenRecovery = useCallback(async () => {
    const opened = await openRecoveryCopy()
    if (!opened) {
      pushToast({ message: "That project can't be found" })
      return
    }
    useEditorStore.temporal.getState().clear()
  }, [openRecoveryCopy, pushToast])

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

  /**
   * Opens the purchase page: the Pro pack for a first purchase, which activates
   * this computer automatically when the payment settles (design §4).
   */
  const startFirstPurchase = useCallback(async () => {
    // API data wins; the hardcoded pack id is only the offline fallback.
    const catalogue = (await window.electronAPI.listProducts?.())?.products ?? null
    const productId = pickFirstPurchaseProductId(catalogue, CREDIT_PACKS[0].productId)
    await useEditorStore.getState().startPurchase(productId)
  }, [])

  const renderHeaderActions = () => {
    const isWindows = platform === 'win32'
    const actions = [
      <ExportButton key="export" isExporting={isExporting} onClick={openExportModal} disabled={duration <= 0} />,
      <Button
        key="publish"
        variant="secondary"
        size="sm"
        onClick={() => setPublishOpen(true)}
        disabled={duration <= 0 || publishTarget === null}
        title={
          publishTarget === null
            ? 'Export this project first — publishing sends the exported video'
            : 'Publish this video behind a share link'
        }
        className="h-8"
      >
        <Share size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
        Publish
      </Button>,
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
      // Appended last so the flex-row-reverse cluster shows it left-most, i.e.
      // [capsule] [Presets] [Export] in the design reference §1.
      <CreditCapsule
        key="credits"
        onBuyCredits={() => useEditorStore.getState().openBuyCredits()}
        onGetPro={() => void startFirstPurchase()}
        onEnterKey={() => setActivateOpen(true)}
      />,
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
              onOpenRecovery={() => void handleOpenRecovery()}
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
          className={cn('flex-shrink-0 overflow-hidden bg-panel', isPreviewFullScreen && 'hidden')}
          style={isPreviewFullScreen ? undefined : { width: sidebarWidth }}
        >
          <SidePanel />
        </div>
        {/* Drag handle to resize the inspector, mirroring the timeline's height handle. */}
        {!isPreviewFullScreen && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector panel"
            title="Drag to resize the inspector"
            onMouseDown={beginSidebarResize}
            className="group/inspector-resize relative z-10 w-1.5 shrink-0 cursor-ew-resize border-r border-line bg-panel
              after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent
              hover:after:bg-accent active:after:bg-accent"
          />
        )}
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
        cloudProgress={exportCloudProgress}
        result={exportResult}
        onRetryCloud={(request) => void retryCloud(request)}
        onFallbackStandard={(request) => void fallbackToStandard(request)}
      />
      <PresetModal isOpen={isPresetModalOpen} onClose={() => setPresetModalOpen(false)} />

      <PublishDialog
        isOpen={isPublishOpen}
        onClose={() => setPublishOpen(false)}
        capabilities={publishStatus?.publishing ?? null}
        pro={publishStatus?.pro ?? false}
        configured={publishStatus?.configured ?? false}
        isPublishing={isPublishing}
        progress={publishProgress}
        balance={balance}
        filePath={publishTarget?.path ?? null}
        fileSizeBytes={publishTarget?.sizeBytes ?? 0}
        durationSec={duration}
        cues={subtitleCues}
        defaultTitle={projectNameFromPath(currentProjectPath ?? '')}
        onPublish={startPublish}
        onCancel={cancelPublish}
        onUnlock={() => useEditorStore.getState().openBuyCredits()}
        onOpenLibrary={() => {
          setPublishOpen(false)
          setSharedLinksOpen(true)
        }}
        onCopied={(label) => pushToast({ message: `${label} copied to the clipboard` })}
      />

      <SharedLinksDialog
        isOpen={isSharedLinksOpen}
        onClose={() => setSharedLinksOpen(false)}
        publications={publications}
        isLoadingList={isLoadingList}
        onRefresh={loadPublications}
        onDelete={removePublication}
        onAnalytics={publicationAnalytics}
        onCopied={(label) => pushToast({ message: `${label} copied to the clipboard` })}
      />
      <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
      <ActivationDialog
        isOpen={isActivateOpen}
        onClose={() => setActivateOpen(false)}
        onGetPro={() => void startFirstPurchase()}
      />
      <DevicesDialog isOpen={isDevicesOpen} onClose={() => setDevicesOpen(false)} />
      <ResumeCloudDialog
        isOpen={cloudResumeOffer !== null}
        outputPath={cloudResumeOffer?.outputPath ?? null}
        onResume={() => void resumeCloudWatch()}
        onDismiss={() => void dismissCloudResume()}
      />
      <BuyCreditsDialog
        isOpen={buyCreditsOpen}
        shortfall={buyCreditsShortfall}
        onClose={() => useEditorStore.getState().closeBuyCredits()}
      />
      <WaitingForPaymentDialog
        isOpen={waitingForPayment}
        onClose={() => useEditorStore.getState().cancelWaiting()}
        onEnterKey={() => {
          useEditorStore.getState().cancelWaiting()
          setActivateOpen(true)
        }}
        onTryAgain={() => {
          useEditorStore.getState().cancelWaiting()
          useEditorStore.getState().openBuyCredits()
        }}
      />
      {/* Kept clear of the minimised-export bubble in the same corner. */}
      <ToastViewport className={isExporting && isExportMinimized ? 'bottom-20' : 'bottom-5'} />
    </main>
  )
}
