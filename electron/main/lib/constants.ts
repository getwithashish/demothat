// Contains constants and static configurations for the main process.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// --- Paths ---
process.env.APP_ROOT = path.join(__dirname, '..')
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST
process.env.VITE_PUBLIC = VITE_PUBLIC

export const PRELOAD_SCRIPT = path.join(process.env.APP_ROOT!, 'dist-electron/preload.cjs')

// --- Recording ---
export const MOUSE_RECORDING_FPS = 50

// Global accelerators for starting/stopping a recording. Declared here (a
// dependency-free module) so both the shortcut registrar and the tray menu can
// use the same values without a circular import.
export const RECORDING_SHORTCUTS = {
  start: 'CommandOrControl+Shift+R',
  stop: 'CommandOrControl+Shift+S',
} as const

// --- Export ---
export const LINUX_SCALES = [1, 1.5, 2]
export const LINUX_BASE_SIZE = 24
