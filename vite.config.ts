import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// Native modules that need to be externalized for proper runtime loading
// Fix for #137: global-mouse-events not loading on Windows
const nativeModules = ['global-mouse-events', 'node-macos-cursor', 'node-win-cursor', 'x11']

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // The API base URL that gets baked into the main-process bundle (see
  // electron/main/lib/api-config.ts) comes from DEMOTHAT_DEFAULT_API_BASE_URL so
  // it is never committed: development builds read a gitignored .env.development.local
  // (see .env.example) and CI reads a GitHub secret. Precedence: a shell/CI variable
  // beats the .env file, and either beats the defaults below. With no URL supplied,
  // development falls back to the local mock, production to the host baked in the
  // source. A runtime env var (DEMOTHAT_API_BASE_URL) still always wins.
  const loadedEnv = loadEnv(mode, process.cwd(), 'DEMOTHAT_DEFAULT_API_BASE_URL')
  const fromEnv = (loadedEnv.DEMOTHAT_DEFAULT_API_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const devFallback = mode === 'production' ? '' : 'http://localhost:8788'
  const apiBase = fromEnv || devFallback
  if (mode === 'production' && !apiBase) {
    // Enforce the env-only contract: a production binary must have a real API
    // endpoint, and it can only come from the DEMOTHAT_PRODUCTION_API_BASE_URL
    // secret in CI (release.yml). Never ship an empty one silently.
    throw new Error(
      'Production build needs DEMOTHAT_DEFAULT_API_BASE_URL (set the DEMOTHAT_PRODUCTION_API_BASE_URL GitHub secret). No API URL baked — refusing to build.',
    )
  }
  const envDefaults = apiBase ? { 'process.env.DEMOTHAT_DEFAULT_API_BASE_URL': JSON.stringify(apiBase) } : {}

  return {
    base: './',
    plugins: [
      tailwindcss(),
      react(),
      electron({
        main: {
          // Shortcut of `build.lib.entry`.
          entry: 'electron/main/index.ts',
          // Fix for ESM/CommonJS issue on macOS (#138, #131)
          // Output as .cjs to avoid "exports is not defined" error
          // when package.json has "type": "module"
          vite: {
            build: {
              outDir: 'dist-electron',
              lib: {
                entry: 'electron/main/index.ts',
                formats: ['cjs'],
                fileName: () => 'index.cjs',
              },
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                },
                // Fix for #137: Externalize native modules
                // These modules need to be loaded at runtime, not bundled
                external: nativeModules,
              },
            },
            define: envDefaults,
          },
        },
        preload: {
          // Shortcut of `build.rollupOptions.input`.
          // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
          input: path.join(__dirname, 'electron/preload.ts'),
          // Fix for ESM/CommonJS issue on macOS (#138, #131)
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                },
              },
            },
          },
        },
        // Ployfill the Electron and Node.js API for Renderer process.
        // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
        // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
        // renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        // ? undefined
        // : {},
      }),
      nodePolyfills(), // this is necessary to avoid "Buffer is not defined issue"
    ],
  }
})
