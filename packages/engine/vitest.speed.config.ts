import { defineConfig } from 'vitest/config'

/** Speed checks (`pnpm speed`): one file at a time, kept out of `pnpm test`. */
export default defineConfig({
  test: {
    include: ['src/**/*.speed.ts'],
    fileParallelism: false,
    // Print the timings for passing tests too, so CI logs show them.
    silent: false,
    // 35 grid runs per test take ~6 s on a CI runner, over the 5 s default.
    testTimeout: 60_000,
  },
})
