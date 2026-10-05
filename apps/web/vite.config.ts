/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The service worker for working offline (D98). It's built on every
    // deploy, but nothing registers it or links the manifest unless the
    // switch in src/offline.ts is on: no injected script and no generated
    // manifest, so the page offers nothing to install while it's off.
    VitePWA({
      injectRegister: false,
      registerType: 'prompt',
      manifest: false,
      workbox: {
        cacheId: 'signalplan',
        // The app shell, every JS and CSS chunk (the workers and the lazily
        // loaded 3D view among them), the icons and the manifest.
        globPatterns: ['**/*.{html,js,css,svg,png,webmanifest}'],
        // The link-preview image (D97) is for other sites, not the app.
        globIgnores: ['og-image.png'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // palettes.test.ts reads index.css as text to compare colour tokens.
  test: { css: { include: [/index\.css/] } },
})
