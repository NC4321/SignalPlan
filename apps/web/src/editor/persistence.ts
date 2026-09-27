import { parsePlan, SCHEMA_VERSION, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import type { Units } from './units.ts'

/**
 * Plans as files, the sample and blank plans, and the display-units
 * preference (kept in localStorage: it's small and needed before the first
 * render). The plans themselves live in the library (library.ts).
 */
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
export function safeStorage(): Storage | null {
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

/** A stored plan that no longer loads, saved exactly as it was. */
export function rescuePlan(raw: unknown) {
  downloadText(JSON.stringify(raw, null, 2), `unreadable-plan${FILE_EXTENSION}`)
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
