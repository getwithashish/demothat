import { Tray, Menu, nativeImage, app } from 'electron'
import path from 'node:path'
import log from 'electron-log/main'
import type { TrayQuickAction, VirtualStudioStatus } from '../../../../shared/virtual-camera-types'

export interface TrayCallbacks {
  onAction: (action: TrayQuickAction) => void
}

export class VirtualStudioTray {
  private tray: Tray | null = null
  private callbacks: TrayCallbacks | null = null
  private currentStatus: Partial<VirtualStudioStatus> = {
    isPlaying: false,
    isMicMuted: false,
    isMiniHudVisible: true,
    activeSource: 'webcam',
  }

  public init(callbacks: TrayCallbacks): void {
    this.callbacks = callbacks
    if (this.tray) {
      this.updateMenu()
      return
    }

    try {
      const icon = this.getTrayIcon()
      this.tray = new Tray(icon)
      this.tray.setToolTip('DemoThat Virtual Studio')

      // 1-Click Left Click interaction: Instant Play/Pause toggle
      this.tray.on('click', () => {
        log.info('[VirtualStudioTray] Left click triggered: toggle-playback')
        this.callbacks?.onAction('toggle-playback')
      })

      // Right Click opens the flat context menu
      this.tray.on('right-click', () => {
        this.updateMenu()
        this.tray?.popUpContextMenu()
      })

      this.updateMenu()
      log.info('[VirtualStudioTray] System tray initialized successfully')
    } catch (err) {
      log.warn(
        '[VirtualStudioTray] Could not create system tray icon (might be running in headless/test environment):',
        err,
      )
    }
  }

  private getTrayIcon(): Electron.NativeImage {
    try {
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'public', 'demothat-appicon-tray.png')
        : path.join(process.env.APP_ROOT || process.cwd(), 'public', 'demothat-appicon-tray.png')

      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) {
        return img.resize({ width: 16, height: 16 })
      }
    } catch {
      // ignore
    }
    return nativeImage.createEmpty()
  }

  /**
   * Updates tray menu and tooltip based on latest status.
   */
  public updateState(status: Partial<VirtualStudioStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...status }

    if (!this.tray) {
      return
    }

    const isPlaying = !!this.currentStatus.isPlaying
    const isMicMuted = !!this.currentStatus.isMicMuted
    const sourceLabel = isPlaying ? 'Canvas Preview (Playing)' : 'Webcam (Idle/Paused)'
    const micLabel = isMicMuted ? 'Muted' : 'Active'

    this.tray.setToolTip(`DemoThat Virtual Studio - ${sourceLabel} | Mic: ${micLabel}`)
    this.updateMenu()
  }

  private updateMenu(): void {
    if (!this.tray) return

    const isPlaying = !!this.currentStatus.isPlaying
    const isMicMuted = !!this.currentStatus.isMicMuted
    const isHudVisible = this.currentStatus.isMiniHudVisible !== false

    const contextMenu = Menu.buildFromTemplate([
      {
        label: isPlaying ? '⏸ Pause Playback (Show Webcam)' : '▶ Resume Playback',
        click: () => this.callbacks?.onAction('toggle-playback'),
      },
      {
        label: isMicMuted ? '🔊 Unmute Microphone' : '🎙️ Mute Microphone',
        click: () => this.callbacks?.onAction('toggle-mic-mute'),
      },
      {
        label: isHudVisible ? '👁️ Hide Mini-HUD' : '👁️ Show Mini-HUD',
        click: () => this.callbacks?.onAction('toggle-hud'),
      },
      { type: 'separator' },
      {
        label: '⏹ Stop Virtual Studio',
        click: () => this.callbacks?.onAction('stop-studio'),
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }

  public destroy(): void {
    if (this.tray) {
      try {
        this.tray.destroy()
      } catch {
        // ignore
      }
      this.tray = null
    }
    this.callbacks = null
    log.info('[VirtualStudioTray] System tray destroyed')
  }

  public isCreated(): boolean {
    return this.tray !== null
  }
}

export const virtualStudioTray = new VirtualStudioTray()
