import type { Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { GUIDE_STEPS, guideSeen, markGuideSeen } from './guide.ts'
import { samplePlan } from './persistence.ts'

const step = (id: string) => GUIDE_STEPS.find((s) => s.id === id)!

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

describe('guide', () => {
  const start = samplePlan('US')

  it('moves on from "Move an access point" once one has moved', () => {
    const done = step('drag').done!
    expect(done(start, start)).toBe(false)
    const moved: Plan = {
      ...start,
      accessPoints: start.accessPoints.map((ap, i) =>
        i === 0 ? { ...ap, x: ap.x + 0.1 } : ap,
      ),
    }
    expect(done(start, moved)).toBe(true)
    // A new access point isn't a moved one.
    const added: Plan = {
      ...start,
      accessPoints: [
        ...start.accessPoints,
        { ...start.accessPoints[0]!, id: 'new', x: 1 },
      ],
    }
    expect(done(start, added)).toBe(false)
  })

  it('moves on from "Draw a wall" once there are more walls', () => {
    const done = step('wall').done!
    const floor = start.floors[0]!
    const more: Plan = {
      ...start,
      floors: [
        {
          ...floor,
          walls: [...floor.walls, { ...floor.walls[0]!, id: 'w-new' }],
        },
      ],
    }
    expect(done(start, start)).toBe(false)
    expect(done(start, more)).toBe(true)
    expect(done(more, start)).toBe(false)
  })

  it('has four steps, ending on one with no task to do', () => {
    expect(GUIDE_STEPS.map((s) => s.id)).toEqual([
      'heatmap',
      'drag',
      'wall',
      'start',
    ])
    expect(GUIDE_STEPS.at(-1)!.done).toBeUndefined()
  })

  it('remembers being seen, and treats storage that throws as not seen', () => {
    const storage = memoryStorage()
    expect(guideSeen(storage)).toBe(false)
    markGuideSeen(storage)
    expect(guideSeen(storage)).toBe(true)
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(guideSeen(broken)).toBe(false)
    expect(() => markGuideSeen(broken)).not.toThrow()
    expect(guideSeen(null)).toBe(false)
  })
})
