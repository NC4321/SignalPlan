import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import canvasSource from './EditorCanvas.tsx?raw'
import fileMenuSource from './FileMenu.tsx?raw'
import {
  keyForTool,
  shortcutGroups,
  TOOL_KEYS,
  toolForKey,
  toolKeysHint,
} from './shortcuts.ts'

const listed = shortcutGroups('Ctrl').flatMap((group) =>
  group.shortcuts.flatMap((s) => [...s.keys, ...(s.or ?? [])]),
)

describe('shortcuts', () => {
  it('maps each tool key to its tool and back', () => {
    for (const [key, tool] of Object.entries(TOOL_KEYS)) {
      expect(toolForKey(key)).toBe(tool)
      expect(keyForTool(tool)).toBe(key.toUpperCase())
    }
  })

  it('names each shortcut by distinct keys, its key in the overlay', () => {
    for (const group of shortcutGroups('Ctrl')) {
      const keys = group.shortcuts.map((s) => s.keys.join('+'))
      expect(new Set(keys).size, group.title).toBe(keys.length)
    }
  })

  it('ignores keys that pick no tool, inherited names included', () => {
    for (const key of ['x', 'calibrate', 'constructor', 'hasOwnProperty']) {
      expect(toolForKey(key), key).toBeUndefined()
    }
  })

  it('lists every tool key, and says so in the canvas hint', () => {
    const tools = shortcutGroups('Ctrl').find((g) => g.title === 'Tools')!
    expect(tools.shortcuts.map((s) => s.keys[0])).toEqual(
      Object.keys(TOOL_KEYS).map((k) => k.toUpperCase()),
    )
    expect(toolKeysHint()).toMatch(/^V select, W wall, .*, S survey$/)
  })

  it('lists every key the editor’s handlers react to', () => {
    // Keys compared in App.tsx, FileMenu.tsx's Ctrl/⌘ shortcuts and the
    // canvas, as written there, with how the overlay names them. The menu's
    // own arrow keys and Escape belong to the menu, so they're not listed.
    const shown: Record<string, string> = {
      z: 'Z',
      y: 'Y',
      s: 'S',
      o: 'O',
      enter: 'Enter',
      delete: 'Delete',
      backspace: 'Backspace',
      escape: 'Esc',
      PageUp: 'Page Up',
      PageDown: 'Page Down',
      Tab: 'Tab',
      ArrowLeft: 'Arrows',
      ArrowRight: 'Arrows',
      ArrowUp: 'Arrows',
      ArrowDown: 'Arrows',
      Space: 'Space',
    }
    const fileShortcuts = fileMenuSource.slice(
      fileMenuSource.indexOf('Ctrl/⌘+S saves'),
      fileMenuSource.indexOf('return ('),
    )
    const handled = new Set<string>()
    for (const source of [appSource, canvasSource, fileShortcuts]) {
      const keys = source.matchAll(
        /(?:key|code) === '([^']+)'|^\s+(Arrow\w+):/gm,
      )
      for (const [, compared, arrow] of keys) handled.add((compared ?? arrow)!)
    }
    expect(handled.size).toBeGreaterThan(10)
    for (const key of handled) {
      expect(shown[key], `${key} has no name in the test`).toBeDefined()
      expect(listed, key).toContain(shown[key])
    }
  })
})
