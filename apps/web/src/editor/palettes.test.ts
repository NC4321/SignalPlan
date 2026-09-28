import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { PALETTES } from './palettes.ts'

/** The custom properties set in the first block matching `selector`. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!]),
  )
}

const light = tokens(css.slice(0, css.indexOf('@media')))
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)')
const dark = tokens(css.slice(darkStart, css.indexOf('\n}\n', darkStart)))

describe('PALETTES', () => {
  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('matches the %s tokens in index.css', (theme, fromCss) => {
    for (const [name, value] of Object.entries(PALETTES[theme])) {
      // An exported image's canvas is the plain surface colour.
      const expected =
        name === '--canvas' ? fromCss['--surface'] : fromCss[name]
      expect([name, value]).toEqual([name, expected])
    }
  })
})
