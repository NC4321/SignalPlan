import {
  loadPlan,
  parsePlan,
  SCHEMA_VERSION,
  type Plan,
  type PlanIssue,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import type { Units } from './units.ts'

/**
 * Keeping the plan in the browser (D20): one current plan in localStorage,
 * autosaved after every change, plus the display-units preference. Files are
 * for sharing and backup.
 */
export const PLAN_KEY = 'signalplan:plan'
export const UNITS_KEY = 'signalplan:units'

/** The file extension for saved plans: plain JSON, recognisable by name. */
export const FILE_EXTENSION = '.signalplan.json'

export function samplePlan(): Plan {
  const result = parsePlan(sampleHome)
  if (!result.ok) {
    throw new Error(`Sample plan is invalid: ${result.issues[0]?.message}`)
  }
  return result.plan
}

/**
 * A blank plan: one empty floor and one dual-band router in the middle of the
 * starting view, so there is coverage to see as soon as walls are drawn.
 */
export function blankPlan(): Plan {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled plan',
    floors: [
      {
        id: 'main',
        name: 'Main floor',
        elevationM: 0,
        heightM: 2.4,
        nodes: [],
        walls: [],
        openings: [],
      },
    ],
    accessPoints: [
      {
        id: 'router',
        name: 'Router',
        floorId: 'main',
        x: 5,
        y: 4,
        heightM: 1,
        radios: [{ band: '2.4GHz' }, { band: '5GHz' }],
      },
    ],
  }
}

/** The view a plan with no walls opens on: 10 m × 8 m around the router. */
export const BLANK_BOUNDS = { minX: 0, minY: 0, maxX: 10, maxY: 8 }

type Stored =
  | { kind: 'none' }
  | { kind: 'plan'; plan: Plan }
  | { kind: 'invalid'; issues: PlanIssue[] }

/** The plan saved in this browser, if any. */
export function readSavedPlan(storage: Storage | null = safeStorage()): Stored {
  let text: string | null = null
  try {
    text = storage?.getItem(PLAN_KEY) ?? null
  } catch {
    return { kind: 'none' }
  }
  if (text === null) return { kind: 'none' }
  const result = loadPlan(text)
  return result.ok
    ? { kind: 'plan', plan: result.plan }
    : { kind: 'invalid', issues: result.issues }
}

export type SaveResult = 'saved' | 'full' | 'unavailable'

/** Saves the plan in this browser. */
export function writeSavedPlan(
  plan: Plan,
  storage: Storage | null = safeStorage(),
): SaveResult {
  if (!storage) return 'unavailable'
  try {
    storage.setItem(PLAN_KEY, JSON.stringify(plan))
    return 'saved'
  } catch (error) {
    return error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'full'
      : 'unavailable'
  }
}

export function readUnits(storage: Storage | null = safeStorage()): Units {
  try {
    return storage?.getItem(UNITS_KEY) === 'imperial' ? 'imperial' : 'metric'
  } catch {
    return 'metric'
  }
}

export function writeUnits(
  units: Units,
  storage: Storage | null = safeStorage(),
) {
  try {
    storage?.setItem(UNITS_KEY, units)
  } catch {
    // Only a preference: losing it is harmless.
  }
}

/** localStorage, or null where the browser blocks it. */
function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** A safe file name for a plan, such as `My house.signalplan.json`. */
export function fileName(plan: Plan): string {
  const base = plan.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'plan'
  return `${base}${FILE_EXTENSION}`
}

/** The plan as a file's text: indented JSON, ending in a newline. */
export function planToFile(plan: Plan): string {
  return `${JSON.stringify(plan, null, 2)}\n`
}

/** Offers the plan as a file download. */
export function downloadPlan(plan: Plan) {
  downloadText(planToFile(plan), fileName(plan))
}

/** The saved plan exactly as stored, for rescuing one that no longer loads. */
export function rescueSavedPlan(storage: Storage | null = safeStorage()) {
  try {
    const text = storage?.getItem(PLAN_KEY)
    if (text) downloadText(text, `unreadable-plan${FILE_EXTENSION}`)
  } catch {
    // Nothing more we can do.
  }
}

function downloadText(text: string, name: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
