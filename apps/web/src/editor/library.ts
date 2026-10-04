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

/**
 * Why a save failed: the browser's storage is full (the quota error has
 * different names and codes between browsers), or it can't be used at all,
 * such as in a private window that blocks it.
 */
export function saveFailure(error: unknown): 'full' | 'unavailable' {
  const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
  return name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
    ? 'full'
    : 'unavailable'
}

export function newPlanId(): string {
  return crypto.randomUUID()
}

function openDatabase(name: string) {
  return openDB<LibrarySchema>(name, 1, {
    upgrade(database) {
      const plans = database.createObjectStore('plans', { keyPath: 'id' })
      plans.createIndex('updatedAt', 'updatedAt')
      database.createObjectStore('images', { keyPath: 'id' })
      database.createObjectStore('meta')
    },
  })
}

export class PlanLibrary {
  private db: IDBPDatabase<LibrarySchema>
  private readonly name: string

  private constructor(db: IDBPDatabase<LibrarySchema>, name: string) {
    this.db = db
    this.name = name
  }

  /**
   * Opens the database again, for when the browser closed the connection
   * (it can, after a long idle or an upgrade elsewhere). False if it can't.
   */
  async reconnect(): Promise<boolean> {
    try {
      const db = await openDatabase(this.name)
      try {
        this.db.close()
      } catch {
        // Already closed.
      }
      this.db = db
      return true
    } catch {
      return false
    }
  }

  /** Opens the library, or returns undefined where the browser blocks storage. */
  static async open(name = DATABASE): Promise<PlanLibrary | undefined> {
    try {
      const db = await openDatabase(name)
      return new PlanLibrary(db, name)
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
      return saveFailure(error)
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

  /** Stores a tracing image, returning its id. */
  async addImage(blob: Blob): Promise<string> {
    const id = `img-${newPlanId()}`
    await this.db.put('images', { id, blob })
    return id
  }

  async image(id: string): Promise<Blob | undefined> {
    return (await this.db.get('images', id))?.blob
  }

  /**
   * Deletes images no stored plan uses any more: ones replaced or removed
   * (kept until now so undo could bring them back) and ones whose plans were
   * deleted. `keep` protects images the open plan uses but hasn't saved yet.
   */
  async collectGarbage(keep: Iterable<string> = []) {
    const used = new Set(keep)
    for (const stored of await this.db.getAll('plans')) {
      for (const id of imageIdsIn(stored.plan)) used.add(id)
    }
    for (const id of await this.db.getAllKeys('images')) {
      if (!used.has(id)) await this.db.delete('images', id)
    }
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

/** The ids of the tracing images a (possibly unvalidated) plan refers to. */
export function imageIdsIn(plan: unknown): string[] {
  if (!plan || typeof plan !== 'object' || !('floors' in plan)) return []
  const floors = (plan as { floors: unknown }).floors
  if (!Array.isArray(floors)) return []
  return floors.flatMap((floor: unknown) => {
    const id =
      floor && typeof floor === 'object' && 'background' in floor
        ? (floor as { background?: { imageId?: unknown } }).background?.imageId
        : undefined
    return typeof id === 'string' ? [id] : []
  })
}
