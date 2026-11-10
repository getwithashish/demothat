/**
 * Automated Verification Script for Ed UI Redesign
 */

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const OUTPUT_DIR = '/home/ashish/.gemini/antigravity-cli/brain/c1142c1b-42cc-4dd8-a582-a454c29854be/screenshots'
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// Minimal IPC mocks
ipcMain.handle('settings:get', (_e, key) => {
  if (key === 'appearance') return { mode: 'dark', cursorThemeName: 'default' }
  if (key === 'ai.autoApprove') return false
  if (key === 'editor.autoSaveEnabled') return true
  if (key === 'editor.autoSaveIntervalSec') return 30
  if (key === 'project.recentProjects') return []
  return null
})
ipcMain.handle('settings:set', () => true)
ipcMain.handle('presets:load', () => ({}))
ipcMain.handle('desktop:get-displays', () => [{ id: '1', name: 'Primary Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }])
ipcMain.handle('desktop:get-cursor-themes', () => ['default'])
ipcMain.handle('desktop:load-cursor-theme', () => ({}))
ipcMain.handle('app:getVersion', () => '1.0.0')
ipcMain.handle('app:getPlatform', () => process.platform)
ipcMain.handle('app:getSessionInfo', () => ({ type: 'x11' }))
ipcMain.handle('app:getPath', () => '/home/ashish')
ipcMain.handle('window:isMaximized', () => false)
ipcMain.handle('window:zoom-factor', () => 1)
ipcMain.handle('cloud:status', () => ({ ok: true, active: false }))
ipcMain.handle('cloud:consent', () => true)
ipcMain.handle('cloud:capabilities', () => ({ ok: true }))
ipcMain.handle('cloud:active-job', () => null)
ipcMain.handle('entitlement:get', () => ({ pro: true, credits: 500 }))
ipcMain.handle('license:summary', () => ({ status: 'active', pro: true }))
ipcMain.handle('checkout:status', () => ({ pending: false, watching: false }))
ipcMain.handle('products:list', () => [])
ipcMain.handle('export:capabilities', () => ({}))
ipcMain.handle('export:perf', () => ({}))
ipcMain.handle('transcribe:status', () => ({ ready: true }))
ipcMain.handle('publish:status', () => ({ configured: false, pro: false }))
ipcMain.handle('publish:list', () => [])
ipcMain.handle('permission:check-screen-recording', () => true)
ipcMain.handle('ai:chat', () => ({ ok: true }))
ipcMain.handle('ai:providers', () => ({ active: 'mock', providers: [] }))
ipcMain.handle('dialog:showMessageBox', () => ({ response: 0 }))

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function capture(win, filename) {
  await sleep(400)
  const image = await win.webContents.capturePage()
  const outPath = path.join(OUTPUT_DIR, filename)
  fs.writeFileSync(outPath, image.toPNG())
  const stats = fs.statSync(outPath)
  console.log(`Saved screenshot: ${filename} (${stats.size} bytes)`)
}

async function setMode(win, mode) {
  await win.webContents.executeJavaScript(`(() => {
    if (window.__editorStore) {
      window.__editorStore.setState({ mode: '${mode}' });
    }
    document.documentElement.setAttribute('data-theme', '${mode}');
  })()`)
  await sleep(300)
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '../dist-electron/preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 3) console.error('[Renderer Error]', msg)
  })

  const url = `file://${path.join(__dirname, '../dist/index.html')}#editor`
  console.log('Loading:', url)
  await win.loadURL(url)
  await sleep(1500)

  // 1. Switch to Ed tab in inspector
  console.log('Selecting Ed tab...')
  await win.webContents.executeJavaScript(`(() => {
    if (window.__editorStore) {
      window.__editorStore.getState().setActiveSidePanelTab('ai');
    }
  })()`)
  await sleep(500)

  // ─── 1. Empty State (Dark & Light) ──────────────────────────────────────────
  console.log('Capturing empty states...')
  await setMode(win, 'dark')
  await capture(win, '01_sidebar_empty_dark.png')

  await setMode(win, 'light')
  await capture(win, '01_sidebar_empty_light.png')

  // ─── 2. Running Action Card ────────────────────────────────────────────────
  console.log('Simulating running action card...')
  await setMode(win, 'dark')
  win.webContents.send('ai:chunk', {
    type: 'tool_call_start',
    id: 'tool-run-1',
    name: 'run_tidy_up',
    arguments: { threshold: 0.5 }
  })
  win.webContents.send('ai:chunk', {
    type: 'text',
    delta: "I'm analyzing the recording audio and video to detect silences..."
  })
  await sleep(500)
  await capture(win, '02_sidebar_running_action_dark.png')

  await setMode(win, 'light')
  await capture(win, '02_sidebar_running_action_light.png')

  // ─── 3. Completed Action Card ──────────────────────────────────────────────
  console.log('Simulating completed action card...')
  await setMode(win, 'dark')
  win.webContents.send('ai:chunk', {
    type: 'tool_result',
    id: 'tool-run-1',
    result: { cutsRemoved: 8, totalDurationSaved: '14.2s', addedCutAt: 2.5 }
  })
  win.webContents.send('ai:chunk', {
    type: 'done'
  })
  await sleep(500)
  await capture(win, '03_sidebar_completed_action_dark.png')

  await setMode(win, 'light')
  await capture(win, '03_sidebar_completed_action_light.png')

  // ─── 4. Failed Action Card ─────────────────────────────────────────────────
  console.log('Simulating failed action card...')
  await setMode(win, 'dark')
  win.webContents.send('ai:chunk', {
    type: 'tool_call_start',
    id: 'tool-fail-1',
    name: 'add_zoom_region',
    arguments: { zoomLevel: 3, startTime: 5.2 }
  })
  win.webContents.send('ai:chunk', {
    type: 'tool_result',
    id: 'tool-fail-1',
    error: 'Could not detect mouse click near 5.2s'
  })
  await sleep(500)
  await capture(win, '04_sidebar_failed_action_dark.png')

  await setMode(win, 'light')
  await capture(win, '04_sidebar_failed_action_light.png')

  // ─── 5. Approval Required State ───────────────────────────────────────────
  console.log('Simulating approval required card...')
  await setMode(win, 'dark')
  win.webContents.send('ai:chunk', {
    type: 'approval_required',
    id: 'tool-appr-1',
    name: 'add_cut_region',
    arguments: { startTime: 12.0, duration: 4.5 },
    summary: 'Ed proposes cutting 4.5s of dead air between 12.0s and 16.5s'
  })
  await sleep(500)
  await capture(win, '05_sidebar_approval_state_dark.png')

  await setMode(win, 'light')
  await capture(win, '05_sidebar_approval_state_light.png')

  // ─── 6. Command Palette (Empty Query) ──────────────────────────────────────
  console.log('Opening command palette...')
  await setMode(win, 'dark')
  await win.webContents.executeJavaScript(`(() => {
    const askEdBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Ask Ed'));
    if (askEdBtn) askEdBtn.click();
  })()`)
  await sleep(500)
  await capture(win, '06_palette_empty_dark.png')

  await setMode(win, 'light')
  await capture(win, '06_palette_empty_light.png')

  // ─── 7. Command Palette (Filtered Query) ───────────────────────────────────
  console.log('Filtering palette with "zoom"...')
  await setMode(win, 'dark')
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[cmdk-input]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'zoom');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`)
  await sleep(500)
  await capture(win, '07_palette_filtered_dark.png')

  await setMode(win, 'light')
  await capture(win, '07_palette_filtered_light.png')

  // ─── 8. Command Palette (Free-Text "Ask Ed") ───────────────────────────────
  console.log('Typing free-text prompt in palette...')
  await setMode(win, 'dark')
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input[cmdk-input]');
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'tidy up audio and add frame shadow');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`)
  await sleep(500)
  await capture(win, '08_palette_ask_ed_dark.png')

  await setMode(win, 'light')
  await capture(win, '08_palette_ask_ed_light.png')

  console.log('ALL SCREENSHOTS CAPTURED SUCCESSFULLY!')
  app.quit()
})
