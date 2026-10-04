import type { Tool } from './store.ts'

/**
 * The keyboard shortcuts, in one place (D89): the tool keys drive both the
 * key handler (App.tsx) and the toolbar's hints, and every shortcut the
 * editor reacts to is listed for the help overlay, opened with ?.
 */
export const TOOL_KEYS = {
  v: 'select',
  w: 'wall',
  d: 'door',
  n: 'window',
  o: 'floorOpening',
  a: 'accessPoint',
  s: 'survey',
} as const satisfies Record<string, Tool>

/** The tools with a key: all but calibrating a tracing image. */
export type KeyedTool = (typeof TOOL_KEYS)[keyof typeof TOOL_KEYS]

/** The tool a plain key picks, if any. */
export function toolForKey(key: string): KeyedTool | undefined {
  return Object.hasOwn(TOOL_KEYS, key)
    ? TOOL_KEYS[key as keyof typeof TOOL_KEYS]
    : undefined
}

/** A tool's key, upper case as keyboards show it. */
export function keyForTool(tool: KeyedTool): string {
  const entry = Object.entries(TOOL_KEYS).find(([, t]) => t === tool)
  if (!entry) throw new Error(`No key for the ${tool} tool`)
  return entry[0].toUpperCase()
}

const TOOL_NAMES: Record<KeyedTool, string> = {
  select: 'Select and move',
  wall: 'Draw walls',
  door: 'Add doors',
  window: 'Add windows',
  floorOpening: 'Add floor openings (stairwells, atriums)',
  accessPoint: 'Add access points',
  survey: 'Add survey spots',
}

const TOOL_HINTS: Record<KeyedTool, string> = {
  select: 'select',
  wall: 'wall',
  door: 'door',
  window: 'window',
  floorOpening: 'floor opening',
  accessPoint: 'access point',
  survey: 'survey',
}

/** The tool keys in a sentence, such as "V select, W wall, …". */
export function toolKeysHint(): string {
  return Object.entries(TOOL_KEYS)
    .map(([key, tool]) => `${key.toUpperCase()} ${TOOL_HINTS[tool]}`)
    .join(', ')
}

export interface Shortcut {
  /** Each key to press together, as shown on the keyboard. */
  keys: string[]
  /** Another way to do the same, such as Ctrl+Y for redo. */
  or?: string[]
  does: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

/** Every shortcut, grouped; `mod` is Ctrl or ⌘ for this platform. */
export function shortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: 'Tools',
      shortcuts: Object.entries(TOOL_KEYS).map(([key, tool]) => ({
        keys: [key.toUpperCase()],
        does: TOOL_NAMES[tool],
      })),
    },
    {
      title: 'Editing',
      shortcuts: [
        { keys: [mod, 'Z'], does: 'Undo' },
        { keys: [mod, 'Shift', 'Z'], or: [mod, 'Y'], does: 'Redo' },
        { keys: ['Tab'], does: 'Select the next item on the plan' },
        { keys: ['Shift', 'Tab'], does: 'Select the previous item' },
        { keys: ['Arrows'], does: 'Move the selection a little' },
        { keys: ['Shift', 'Arrows'], does: 'Move it five times as far' },
        { keys: ['Delete'], or: ['Backspace'], does: 'Delete the selection' },
        {
          keys: ['Enter'],
          does: 'Finish a wall or floor opening being drawn',
        },
        {
          keys: ['Esc'],
          does: 'Finish or drop what’s being drawn, stop a search, then back to Select',
        },
        {
          keys: ['0–9'],
          does: 'While drawing a wall, type its exact length',
        },
      ],
    },
    {
      title: 'Floors and view',
      shortcuts: [
        { keys: ['Page Up'], does: 'Floor above' },
        { keys: ['Page Down'], does: 'Floor below' },
        { keys: ['Space', 'drag'], does: 'Pan' },
        { keys: ['Wheel'], does: 'Pan' },
        { keys: [mod, 'Wheel'], does: 'Zoom at the pointer' },
      ],
    },
    {
      title: 'Files and help',
      shortcuts: [
        { keys: [mod, 'S'], does: 'Save to file' },
        { keys: [mod, 'O'], does: 'Open a file' },
        { keys: ['?'], does: 'Show these shortcuts' },
      ],
    },
  ]
}
