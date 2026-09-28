import { defineConfig } from 'vitest/config'

/** Speed checks (`pnpm speed`): one file at a time, kept out of `pnpm test`. */
export default defineConfig({
  test: {
    include: ['src/**/*.speed.ts'],
    fileParallelism: false,
    // Print the timings for passing tests too, so CI logs show them.
    silent: false,
  },
})
