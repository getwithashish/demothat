import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Renderer-only Vite config for reviewing the dev UI gallery without the Electron
 * runtime (the Electron binary is not installed in every environment, and
 * `vite-plugin-electron` aborts the dev server when it can't spawn it).
 *
 *   npx vite --config vite.gallery.config.ts
 *   → http://localhost:5174/?ui-gallery
 *
 * Not used by `npm run dev`, `npm run build` or any packaged build.
 */
export default defineConfig({
  base: './',
  plugins: [tailwindcss(), react(), nodePolyfills()],
  server: { port: 5174, strictPort: true },
})
