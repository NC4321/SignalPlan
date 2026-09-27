import { parsePlan, type Plan, type PlanIssue } from '@signalplan/floorplan'
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * The plans kept in this browser (D21): a list in IndexedDB, each plan stored
 * with when it was created and last edited. Background images for tracing
 * have their own store, since they can be several megabytes.
 */
interface LibrarySchema extends DBSchema {
  plans: {
    key: string
    value: StoredPlan
    indexes: { updatedAt: number }
  }
  images: { key: string; value: { id: string; blob: Blob } }
  meta: { key: string; value: string }
}

export interface StoredPlan {
  id: string
  /** As saved; validated (and migrated) when opened. */
  plan: unknown
  name: string
  createdAt: number
  updatedAt: number
}

export interface PlanSummary {
  id: string
  name: string
  updatedAt: number
}

export type Opened =
  | { kind: 'plan'; plan: Plan }
  | { kind: 'invalid'; issues: PlanIssue[]; raw: unknown }
  | { kind: 'missing' }

export type SaveResult = 'saved' | 'full' | 'unavailable'

const DATABASE = 'signalplan'
const LAST_PLAN = 'lastPlanId'
/** Where the single-plan version (before D21) kept the plan. */
export const LEGACY_PLAN_KEY = 'signalplan:plan'

export function newPlanId(): string {
  return crypto.randomUUID()
}

export class PlanLibrary {
  private readonly db: IDBPDatabase<LibrarySchema>

  private constructor(db: IDBPDatabase<LibrarySchema>) {
    this.db = db
  }

  /** Opens the library, or returns undefined where the browser blocks storage. */
  static async open(name = DATABASE): Promise<PlanLibrary | undefined> {
    try {
      const db = await openDB<LibrarySchema>(name, 1, {
        upgrade(database) {
          const plans = database.createObjectStore('plans', { keyPath: 'id' })
          plans.createIndex('updatedAt', 'updatedAt')
          database.createObjectStore('images', { keyPath: 'id' })
          database.createObjectStore('meta')
        },
      })
      return new PlanLibrary(db)
    } catch {
      return undefined
    }
  }

  close() {
    this.db.close()
  }

  /** Every plan, most recently edited first. */
  async list(): Promise<PlanSummary[]> {
    const plans = await this.db.getAllFromIndex('plans', 'updatedAt')
    return plans
      .reverse()
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
  }

  async open(id: string): Promise<Opened> {
    const stored = await this.db.get('plans', id)
    if (!stored) return { kind: 'missing' }
    const result = parsePlan(stored.plan)
    return result.ok
      ? { kind: 'plan', plan: result.plan }
      : { kind: 'invalid', issues: result.issues, raw: stored.plan }
  }

  /** Saves a plan under an id, adding it to the list if it's new. */
  async save(id: string, plan: Plan, now = Date.now()): Promise<SaveResult> {
    try {
      const existing = await this.db.get('plans', id)
      await this.db.put('plans', {
        id,
        plan,
        name: plan.name,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
      await this.db.put('meta', id, LAST_PLAN)
      return 'saved'
    } catch (error) {
      return error instanceof DOMException &&
        error.name === 'QuotaExceededError'
        ? 'full'
        : 'unavailable'
    }
  }

  async remove(id: string) {
    await this.db.delete('plans', id)
    if ((await this.lastPlanId()) === id)
      await this.db.delete('meta', LAST_PLAN)
  }

  /** Renames a plan that isn't open (the open one is renamed by editing it). */
  async rename(id: string, name: string) {
    const stored = await this.db.get('plans', id)
    const trimmed = name.trim().slice(0, 200)
    if (!stored || trimmed === '') return
    const plan =
      stored.plan && typeof stored.plan === 'object'
        ? { ...(stored.plan as object), name: trimmed }
        : stored.plan
    await this.db.put('plans', { ...stored, plan, name: trimmed })
  }

  /** Copies a plan as a new one named "Copy of …", returning its id. */
  async duplicate(id: string, now = Date.now()): Promise<string | undefined> {
    const stored = await this.db.get('plans', id)
    if (!stored) return undefined
    const copy = newPlanId()
    const name = `Copy of ${stored.name}`.slice(0, 200)
    const plan =
      stored.plan && typeof stored.plan === 'object'
        ? { ...(stored.plan as object), name }
        : stored.plan
    await this.db.put('plans', {
      id: copy,
      plan,
      name,
      createdAt: now,
      updatedAt: now,
    })
    return copy
  }

  async lastPlanId(): Promise<string | undefined> {
    return this.db.get('meta', LAST_PLAN)
  }

  async setLastPlanId(id: string) {
    await this.db.put('meta', id, LAST_PLAN)
  }

  /**
   * Moves a plan saved by the single-plan version (localStorage) into the
   * list, and makes it the one that opens. Runs once; the old copy is removed.
   */
  async migrateFrom(storage: Storage | null, now = Date.now()) {
    let text: string | null = null
    try {
      text = storage?.getItem(LEGACY_PLAN_KEY) ?? null
    } catch {
      return
    }
    if (text === null) return
    let plan: unknown
    try {
      plan = JSON.parse(text)
    } catch {
      plan = text
    }
    const id = newPlanId()
    const name =
      plan &&
      typeof plan === 'object' &&
      'name' in plan &&
      typeof plan.name === 'string'
        ? plan.name
        : 'Recovered plan'
    await this.db.put('plans', {
      id,
      plan,
      name,
      createdAt: now,
      updatedAt: now,
    })
    await this.setLastPlanId(id)
    storage?.removeItem(LEGACY_PLAN_KEY)
  }
}
