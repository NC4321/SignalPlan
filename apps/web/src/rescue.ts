import type { Plan } from '@signalplan/floorplan'
import type { PlanLibrary } from './editor/library.ts'
import {
  downloadText,
  fileName,
  planToFile,
  safeBaseName,
} from './editor/persistence.ts'
import { embedImages } from './editor/tracing.ts'

/** How long to wait for tracing images before saving the plan without them. */
export const IMAGE_TIMEOUT_MS = 2000

/** Set by "Reload SignalPlan" on the crash screen, for the next load only. */
const RELOAD_FLAG = 'signalplan:reload-after-crash'

export function markReloadAfterCrash() {
  try {
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch {
    // Without it the last plan opens as usual.
  }
}

/** Whether this load follows a reload from the crash screen (once only). */
export function takeReloadAfterCrash(): boolean {
  try {
    const set = sessionStorage.getItem(RELOAD_FLAG) === '1'
    sessionStorage.removeItem(RELOAD_FLAG)
    return set
  } catch {
    return false
  }
}

/** A plan as a file's name and text, ready to save. */
export interface RescueFile {
  name: string
  text: string
}

/**
 * The plan to offer for download when the editor has crashed (D91): in the
 * same format as File › Save to file, with tracing images embedded. It comes
 * from the store (`getPlan`), which lives outside React and so survives a
 * render error; if that can't be read or written out, from the copy the
 * autosaver last put in the library. Nothing here touches React state.
 */
export async function rescueFile(
  getPlan: () => Plan,
  library: PlanLibrary | undefined,
  timeoutMs = IMAGE_TIMEOUT_MS,
): Promise<RescueFile | undefined> {
  try {
    const plan = getPlan()
    let whole = plan
    try {
      whole = await Promise.race([
        embedImages(plan, library),
        new Promise<Plan>((_, reject) =>
          setTimeout(() => reject(new Error('timed out')), timeoutMs),
        ),
      ])
    } catch {
      // Without its tracing images the plan is still worth having.
    }
    return { name: fileName(plan), text: planToFile(whole) }
  } catch {
    // Fall through to the saved copy.
  }
  try {
    const id = await library?.lastPlanId()
    const opened = id ? await library?.open(id) : undefined
    if (opened?.kind === 'plan') {
      return { name: fileName(opened.plan), text: planToFile(opened.plan) }
    }
    if (opened?.kind === 'invalid') {
      const raw = opened.raw
      const name =
        raw && typeof raw === 'object' && 'name' in raw
          ? String(raw.name)
          : 'plan'
      return {
        name: `${safeBaseName(name)}.signalplan.json`,
        text: `${JSON.stringify(raw, null, 2)}\n`,
      }
    }
  } catch {
    // Nothing more to try.
  }
  return undefined
}

/** Saves the plan as a file; false if there was none to save. */
export async function downloadRescue(
  getPlan: () => Plan,
  library: PlanLibrary | undefined,
): Promise<boolean> {
  try {
    const file = await rescueFile(getPlan, library)
    if (!file) return false
    downloadText(file.text, file.name)
    return true
  } catch {
    return false
  }
}
