/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // palettes.test.ts reads index.css as text to compare colour tokens.
  test: { css: { include: [/index\.css/] } },
})
