import { Menu, shell } from 'electron'
import { appState } from '../state'

/** Forwards a File-menu command to the editor renderer. */
function sendMenuCommand(command: 'save' | 'save-copy' | 'open'): void {
  const win = appState.editorWin
  if (win && !win.isDestroyed()) win.webContents.send('menu:command', command)
}

/**
 * Creates and sets the main application menu for the Editor window.
 * Uses standard roles for cross-platform consistency.
 */
export function createEditorMenu() {
  const isMac = process.platform === 'darwin'

  const template: (Electron.MenuItemConstructorOptions | Electron.MenuItem)[] = [
    // On macOS, the first menu item is the App menu
    ...(isMac ? ([{ role: 'appMenu' }] as Electron.MenuItemConstructorOptions[]) : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand('open') },
        { type: 'separator' },
        { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => sendMenuCommand('save') },
        // No accelerator: Cmd/Ctrl+Shift+S is the global "stop recording" shortcut.
        { label: 'Save a Copy…', click: () => sendMenuCommand('save-copy') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      // Explicit View menu: the default `viewMenu` role also ships zoom items
      // whose accelerators (CmdOrCtrl+Plus / Minus / 0) would swallow the
      // renderer's zoom shortcuts. Interface and timeline zoom are handled in
      // the renderer instead (see useZoomControls).
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More on GitHub',
          click: async () => {
            await shell.openExternal('https://github.com/getwithashish/DemoThat')
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

/**
 * Clears the application menu. Useful when no windows are active
 * or when switching to a window that doesn't need a full menu.
 */
export function clearMenu() {
  Menu.setApplicationMenu(null)
}
