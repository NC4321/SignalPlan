import { parsePlan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  blankPlan,
  fileName,
  PLAN_KEY,
  planToFile,
  readSavedPlan,
  readUnits,
  samplePlan,
  writeSavedPlan,
  writeUnits,
} from './persistence.ts'

/** An in-memory Storage, optionally refusing writes like a full quota. */
function memoryStorage(full = false): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => {
      if (full) throw new DOMException('full', 'QuotaExceededError')
      data.set(key, value)
    },
  }
}

describe('saved plan', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage()
    const plan = samplePlan()
    expect(writeSavedPlan(plan, storage)).toBe('saved')
    expect(readSavedPlan(storage)).toEqual({ kind: 'plan', plan })
  })

  it('reports nothing saved', () => {
    expect(readSavedPlan(memoryStorage())).toEqual({ kind: 'none' })
  })

  it('reports a saved plan that no longer validates', () => {
    const storage = memoryStorage()
    storage.setItem(PLAN_KEY, '{"schemaVersion": 99}')
    const result = readSavedPlan(storage)
    expect(result.kind).toBe('invalid')
  })

  it('reports a full storage quota', () => {
    expect(writeSavedPlan(samplePlan(), memoryStorage(true))).toBe('full')
  })

  it('reports storage that is unavailable', () => {
    expect(writeSavedPlan(samplePlan(), null)).toBe('unavailable')
  })
})

describe('units preference', () => {
  it('remembers imperial and defaults to metric', () => {
    const storage = memoryStorage()
    expect(readUnits(storage)).toBe('metric')
    writeUnits('imperial', storage)
    expect(readUnits(storage)).toBe('imperial')
  })
})

describe('blankPlan', () => {
  it('is a valid plan with one router and no walls', () => {
    const plan = blankPlan()
    expect(parsePlan(plan)).toEqual({ ok: true, plan })
    expect(plan.accessPoints).toHaveLength(1)
    expect(plan.floors[0]!.walls).toEqual([])
  })
})

describe('files', () => {
  it('names files after the plan, without unsafe characters', () => {
    expect(fileName({ ...blankPlan(), name: 'My house' })).toBe(
      'My house.signalplan.json',
    )
    expect(fileName({ ...blankPlan(), name: 'a/b: c?' })).toBe(
      'a-b- c-.signalplan.json',
    )
    expect(fileName({ ...blankPlan(), name: '  ' })).toBe(
      'plan.signalplan.json',
    )
  })

  it('writes JSON that loads back as the same plan', () => {
    const plan = samplePlan()
    expect(parsePlan(JSON.parse(planToFile(plan)))).toEqual({ ok: true, plan })
  })
})
