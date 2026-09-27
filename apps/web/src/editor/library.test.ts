import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LEGACY_PLAN_KEY, PlanLibrary } from './library.ts'
import { blankPlan, samplePlan } from './persistence.ts'

let library: PlanLibrary
let counter = 0

beforeEach(async () => {
  // A fresh database per test.
  library = (await PlanLibrary.open(`test-${counter++}`))!
})

afterEach(() => library.close())

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

describe('PlanLibrary', () => {
  it('saves and opens a plan, remembering it as the last one', async () => {
    const plan = samplePlan()
    expect(await library.save('a', plan)).toBe('saved')
    expect(await library.open('a')).toEqual({ kind: 'plan', plan })
    expect(await library.lastPlanId()).toBe('a')
  })

  it('lists plans with the most recently edited first', async () => {
    await library.save('old', { ...blankPlan(), name: 'Old' }, 1000)
    await library.save('new', { ...blankPlan(), name: 'New' }, 2000)
    expect(await library.list()).toEqual([
      { id: 'new', name: 'New', updatedAt: 2000 },
      { id: 'old', name: 'Old', updatedAt: 1000 },
    ])
  })

  it('keeps the creation time when saving again', async () => {
    await library.save('a', blankPlan(), 1000)
    await library.save('a', blankPlan(), 5000)
    const [summary] = await library.list()
    expect(summary?.updatedAt).toBe(5000)
  })

  it('reports a missing plan', async () => {
    expect(await library.open('nope')).toEqual({ kind: 'missing' })
  })

  it('reports a stored plan that no longer validates, with its raw data', async () => {
    await library.migrateFrom(
      (() => {
        const storage = memoryStorage()
        storage.setItem(LEGACY_PLAN_KEY, '{"schemaVersion": 99}')
        return storage
      })(),
    )
    const id = (await library.lastPlanId())!
    const opened = await library.open(id)
    expect(opened.kind).toBe('invalid')
    expect(opened.kind === 'invalid' && opened.raw).toEqual({
      schemaVersion: 99,
    })
  })

  it('renames, duplicates and removes plans', async () => {
    await library.save('a', { ...blankPlan(), name: 'Flat' })
    await library.rename('a', '  My flat ')
    const copy = (await library.duplicate('a'))!
    expect((await library.list()).map((p) => p.name).sort()).toEqual([
      'Copy of My flat',
      'My flat',
    ])
    const opened = await library.open(copy)
    expect(opened.kind === 'plan' && opened.plan.name).toBe('Copy of My flat')

    await library.remove('a')
    expect((await library.list()).map((p) => p.id)).toEqual([copy])
    expect(await library.lastPlanId()).toBeUndefined()
  })

  it('moves a plan from the single-plan version into the list once', async () => {
    const storage = memoryStorage()
    storage.setItem(LEGACY_PLAN_KEY, JSON.stringify(samplePlan()))
    await library.migrateFrom(storage)
    await library.migrateFrom(storage)
    const plans = await library.list()
    expect(plans).toHaveLength(1)
    expect(plans[0]?.name).toBe('Sample bungalow')
    expect(await library.lastPlanId()).toBe(plans[0]?.id)
    expect(storage.getItem(LEGACY_PLAN_KEY)).toBeNull()
  })

  it('stores images and deletes ones no plan uses', async () => {
    const used = await library.addImage(new Blob(['a'], { type: 'image/png' }))
    const unused = await library.addImage(
      new Blob(['b'], { type: 'image/png' }),
    )
    const kept = await library.addImage(new Blob(['c'], { type: 'image/png' }))
    const plan = blankPlan()
    plan.floors[0]!.background = {
      imageId: used,
      x: 0,
      y: 0,
      metresPerPixel: 0.01,
      widthPx: 10,
      heightPx: 10,
      opacity: 0.5,
      visible: true,
      locked: true,
    }
    await library.save('a', plan)
    await library.collectGarbage([kept])
    expect(await library.image(used)).toBeDefined()
    expect(await library.image(kept)).toBeDefined()
    expect(await library.image(unused)).toBeUndefined()
  })
})
