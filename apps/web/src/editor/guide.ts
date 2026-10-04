import type { Plan } from '@signalplan/floorplan'
import { safeStorage } from './persistence.ts'

/**
 * The guided first run (D90): four steps over the plan that's open, shown
 * once on a first visit and again from the shortcuts dialog.
 */
export const GUIDE_KEY = 'signalplan:guide'

export interface GuideStep {
  id: string
  title: string
  body: string
  /** The control the step is about, ringed while it shows. */
  target?: string
  /** Whether the reader has done the step, from the plan as it was then. */
  done?: (start: Plan, now: Plan) => boolean
}

export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    id: 'heatmap',
    title: 'Your Wi-Fi, predicted',
    body: 'The colours are the signal SignalPlan predicts from the walls and access points: the legend under Details says which is which. Nothing is measured yet.',
  },
  {
    id: 'drag',
    title: 'Move an access point',
    body: 'Drag an access point, the circle with its name, and watch the coverage follow it through the walls.',
    done: (start, now) =>
      now.accessPoints.some((ap) => {
        const before = start.accessPoints.find((a) => a.id === ap.id)
        return before !== undefined && (before.x !== ap.x || before.y !== ap.y)
      }),
  },
  {
    id: 'wall',
    title: 'Draw a wall',
    body: 'Pick Wall (or press W), click to place corners, and double-click or press Enter to finish. Concrete and brick block more than drywall.',
    target: '.toolbar [aria-keyshortcuts="W"]',
    done: (start, now) => wallCount(now) > wallCount(start),
  },
  {
    id: 'start',
    title: 'Plan your own home',
    body: 'File › New plan starts from a blank floor, or trace over a floor plan image to draw to scale. Press ? for every shortcut, and to see this guide again.',
    target: '[data-guide="file-menu"]',
  },
]

function wallCount(plan: Plan): number {
  return plan.floors.reduce((n, floor) => n + floor.walls.length, 0)
}

/** Whether this browser has seen the guide; storage that throws counts as not. */
export function guideSeen(storage: Storage | null = safeStorage()): boolean {
  try {
    return storage?.getItem(GUIDE_KEY) === 'seen'
  } catch {
    return false
  }
}

export function markGuideSeen(storage: Storage | null = safeStorage()) {
  try {
    storage?.setItem(GUIDE_KEY, 'seen')
  } catch {
    // Only a preference: at worst the guide shows again next time.
  }
}
