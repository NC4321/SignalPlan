import { parsePlan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  blankPlan,
  fileName,
  planToFile,
  readUnits,
  samplePlan,
  writeUnits,
} from './persistence.ts'

/** An in-memory Storage. */
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
