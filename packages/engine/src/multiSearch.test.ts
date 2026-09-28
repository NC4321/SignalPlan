import type { AccessPoint, Floor, Plan } from '@signalplan/floorplan'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MAX_ADDED,
  mulberry32,
  searchHowMany,
  searchMultiPlacement,
  type HowManyProblem,
  type HowManyResult,
  type MultiPlacementProblem,
  type MultiSearchResult,
} from './multiSearch.ts'
import { ap, freeSpaceDbm, room } from './testPlans.ts'
import { handlePlacementRequest, type PlacementMessage } from './worker.ts'

/**
 * Two 4 × 4 m rooms side by side, split by a metal wall that stops almost
 * everything (D12). From a room's centre its corners are 2.83 m away, so a
 * reach of 2.9 m covers a room from its middle but never both rooms.
 */
const twoRooms = () => room(8, 4, { x: 4, material: 'metal' })
const reach = freeSpaceDbm(2.9)

function problem(
  floor: Floor,
  {
    moving = [],
    fixed = [],
    add = 0,
    minDbm = reach,
  }: {
    moving?: AccessPoint[]
    fixed?: AccessPoint[]
    add?: number
    minDbm?: number
  },
): MultiPlacementProblem {
  return {
    plan: {
      schemaVersion: 1,
      id: 'p',
      name: 'Plan',
      floors: [floor],
      accessPoints: [...fixed, ...moving],
    } as Plan,
    floorId: 'f',
    band: '5GHz',
    minDbm,
    fixed,
    moving,
    add,
    template: { heightM: 1, radios: [{ band: '5GHz' }] },
  }
}

function found(result: MultiSearchResult) {
  if (result.kind !== 'found') throw new Error(result.kind)
  return result
}

describe('searchMultiPlacement', () => {
  it('adds one access point to each room', () => {
    const result = found(searchMultiPlacement(problem(twoRooms(), { add: 2 })))
    expect(result.share).toBe(1)
    const xs = result.positions.map((p) => p.x).sort((a, b) => a - b)
    expect(xs[0]).toBeLessThan(4)
    expect(xs[1]).toBeGreaterThan(4)
    // Nothing moves or exists before, so nothing is covered.
    expect(result.before).toBe(0)
  })

  it('moves one of two access points out of the room they share', () => {
    const result = found(
      searchMultiPlacement(
        problem(twoRooms(), { moving: [ap(1.5, 2), ap(2.5, 2)] }),
      ),
    )
    // Before, the right room is dark: half the floor.
    expect(result.before).toBeCloseTo(0.5, 2)
    expect(result.share).toBe(1)
    const xs = result.positions.map((p) => p.x).sort((a, b) => a - b)
    expect(xs[0]).toBeLessThan(4)
    expect(xs[1]).toBeGreaterThan(4)
  })

  it('works around a locked access point', () => {
    const result = found(
      searchMultiPlacement(problem(twoRooms(), { fixed: [ap(2, 2)], add: 1 })),
    )
    expect(result.positions).toHaveLength(1)
    expect(result.positions[0]!.x).toBeGreaterThan(4)
    expect(result.share).toBe(1)
  })

  it('gives the same answer every time (fixed seed)', () => {
    const p = problem(twoRooms(), {
      moving: [ap(1, 1)],
      add: 1,
      minDbm: freeSpaceDbm(2.4),
    })
    expect(searchMultiPlacement(p)).toEqual(searchMultiPlacement(p))
  })

  it('never ends below where refining started, or below now', () => {
    // Random layouts of two moving access points and targets that one
    // access point per room may or may not meet.
    const position = fc.record({
      x: fc.double({ min: 0.3, max: 7.7, noNaN: true }),
      y: fc.double({ min: 0.3, max: 3.7, noNaN: true }),
    })
    fc.assert(
      fc.property(
        position,
        position,
        fc.double({ min: 1.5, max: 3.5, noNaN: true }),
        fc.integer({ min: 0, max: 1 }),
        (a, b, reachM, add) => {
          const p = problem(twoRooms(), {
            moving: [ap(a.x, a.y), ap(b.x, b.y)],
            add,
            minDbm: freeSpaceDbm(reachM),
          })
          const refined = found(searchMultiPlacement(p))
          const unrefined = found(searchMultiPlacement(p, { refine: false }))
          expect(refined.share).toBeGreaterThanOrEqual(unrefined.share)
          expect(refined.share).toBeGreaterThanOrEqual(refined.before)
        },
      ),
      { numRuns: 12 },
    )
  })

  it('stops at the time budget with a full layout', () => {
    let t = 0
    const result = found(
      searchMultiPlacement(
        problem(twoRooms(), { moving: [ap(1, 1)], add: 1 }),
        {
          now: () => (t += 1000),
          budgetMs: 5000,
        },
      ),
    )
    expect(result.stoppedEarly).toBe(true)
    expect(result.positions).toHaveLength(2)
  })

  it('reports progress from 0 to 1', () => {
    const fractions: number[] = []
    searchMultiPlacement(problem(twoRooms(), { add: 1 }), {
      onProgress: (f) => fractions.push(f),
    })
    expect(fractions.at(-1)).toBe(1)
    expect(fractions.every((f, i) => i === 0 || f >= fractions[i - 1]!)).toBe(
      true,
    )
  })

  it('says why it can’t search', () => {
    expect(searchMultiPlacement(problem(twoRooms(), {}))).toEqual({
      kind: 'nothing-to-place',
    })
    const noRadio = problem(twoRooms(), { add: 1 })
    noRadio.template = { heightM: 1, radios: [{ band: '6GHz' }] }
    expect(searchMultiPlacement(noRadio)).toEqual({ kind: 'no-radio' })
    const open = room(4, 4)
    open.walls.pop()
    expect(searchMultiPlacement(problem(open, { add: 1 }))).toEqual({
      kind: 'no-floor-area',
    })
  })
})

/** A how-many problem on `floor`: `goal` share, other settings as above. */
function howMany(
  floor: Floor,
  goal: number,
  options: Parameters<typeof problem>[1] & { maxAdd?: number } = {},
): HowManyProblem {
  const { add: _, ...rest } = problem(floor, options)
  return {
    ...rest,
    goal,
    ...(options.maxAdd !== undefined && { maxAdd: options.maxAdd }),
  }
}

function reached(result: HowManyResult) {
  if (result.kind !== 'found') throw new Error(result.kind)
  return result
}

const sides = (positions: { x: number }[]) =>
  positions.map((p) => (p.x < 4 ? 'left' : 'right')).sort()

describe('searchHowMany', () => {
  // Each room of `twoRooms` needs its own access point, and one covers
  // exactly half the floor.
  it('needs one access point per room for the whole floor', () => {
    const result = reached(searchHowMany(howMany(twoRooms(), 1)))
    expect(result).toMatchObject({ added: 2, reached: true, share: 1 })
    expect(sides(result.positions)).toEqual(['left', 'right'])
    expect(result.before).toBe(0)
  })

  it('stops at one when the goal is under half the floor', () => {
    const result = reached(searchHowMany(howMany(twoRooms(), 0.45)))
    expect(result).toMatchObject({ added: 1, reached: true })
    expect(result.share).toBeCloseTo(0.5, 2)
  })

  it('adds one to the dark room when the lit one has an access point', () => {
    const result = reached(
      searchHowMany(howMany(twoRooms(), 1, { moving: [ap(2, 2)] })),
    )
    expect(result).toMatchObject({ added: 1, reached: true, share: 1 })
    expect(result.positions).toHaveLength(2)
    expect(sides(result.positions)).toEqual(['left', 'right'])
  })

  it('adds none when moving the ones there reaches the goal', () => {
    const result = reached(
      searchHowMany(
        howMany(twoRooms(), 1, { moving: [ap(1.5, 2), ap(2.5, 2)] }),
      ),
    )
    expect(result).toMatchObject({ added: 0, reached: true, share: 1 })
    expect(result.before).toBeCloseTo(0.5, 2)
    expect(sides(result.positions)).toEqual(['left', 'right'])
  })

  it('moves nothing when the goal is already met', () => {
    const moving = [ap(2, 2), ap(6, 2)]
    const result = reached(searchHowMany(howMany(twoRooms(), 0.9, { moving })))
    expect(result).toMatchObject({ added: 0, reached: true, share: 1 })
    expect(result.positions).toEqual([
      { x: 2, y: 2 },
      { x: 6, y: 2 },
    ])
  })

  it('works around a locked access point', () => {
    const result = reached(
      searchHowMany(howMany(twoRooms(), 1, { fixed: [ap(2, 2)] })),
    )
    expect(result).toMatchObject({ added: 1, reached: true, share: 1 })
    expect(sides(result.positions)).toEqual(['right'])
  })

  it('says when the most it may add falls short', () => {
    const result = reached(searchHowMany(howMany(twoRooms(), 1, { maxAdd: 1 })))
    expect(result).toMatchObject({ added: 1, reached: false })
    expect(result.share).toBeCloseTo(0.5, 2)
  })

  it('returns the fewest added among equally good layouts', () => {
    // A target no spot reaches: every count scores 0, so none is added.
    const result = reached(
      searchHowMany(howMany(twoRooms(), 1, { minDbm: 0, maxAdd: 2 })),
    )
    expect(result).toMatchObject({ added: 1, reached: false, share: 0 })
  })

  it('adds at most MAX_ADDED by default', () => {
    // Five rooms in a row, each shut off by metal: four added can't cover
    // five, and one more wouldn't be tried.
    const result = reached(
      searchHowMany({
        ...howMany(twoRooms(), 1),
        plan: {
          ...howMany(twoRooms(), 1).plan,
          floors: [metalRooms(5)],
        },
      }),
    )
    expect(MAX_ADDED).toBe(4)
    expect(result).toMatchObject({ added: 4, reached: false })
    expect(result.share).toBeCloseTo(0.8, 2)
  })

  it('gives the same answer every time (fixed seed)', () => {
    const p = howMany(twoRooms(), 1, { moving: [ap(1, 1)] })
    expect(searchHowMany(p)).toEqual(searchHowMany(p))
  })

  it('stops at the time budget with a full layout', () => {
    let t = 0
    const result = reached(
      searchHowMany(howMany(twoRooms(), 1), {
        now: () => (t += 1000),
        budgetMs: 5000,
      }),
    )
    expect(result.stoppedEarly).toBe(true)
    expect(result.positions).toHaveLength(result.added)
  })

  it('reports progress from 0 to 1', () => {
    const fractions: number[] = []
    searchHowMany(howMany(twoRooms(), 1), {
      onProgress: (f) => fractions.push(f),
    })
    expect(fractions.at(-1)).toBe(1)
    expect(fractions.every((f, i) => i === 0 || f >= fractions[i - 1]!)).toBe(
      true,
    )
  })

  it('says why it can’t search', () => {
    const noRadio = howMany(twoRooms(), 1)
    noRadio.template = { heightM: 1, radios: [{ band: '6GHz' }] }
    expect(searchHowMany(noRadio)).toEqual({ kind: 'no-radio' })
    const open = room(4, 4)
    open.walls.pop()
    expect(searchHowMany(howMany(open, 1))).toEqual({ kind: 'no-floor-area' })
  })
})

/** n 4 × 4 m rooms in a row, split by metal walls. */
function metalRooms(n: number): Floor {
  const nodes = []
  for (let i = 0; i <= n; i++) {
    nodes.push({ id: `b${i}`, x: 4 * i, y: 0 }, { id: `t${i}`, x: 4 * i, y: 4 })
  }
  const walls = []
  for (let i = 0; i < n; i++) {
    walls.push(
      { id: `wb${i}`, from: `b${i}`, to: `b${i + 1}`, material: 'drywall' },
      { id: `wt${i}`, from: `t${i}`, to: `t${i + 1}`, material: 'drywall' },
    )
  }
  for (let i = 0; i <= n; i++) {
    const material = i === 0 || i === n ? 'drywall' : 'metal'
    walls.push({ id: `wv${i}`, from: `b${i}`, to: `t${i}`, material })
  }
  return { ...room(4, 4), nodes, walls } as Floor
}

describe('mulberry32', () => {
  it('repeats for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 1000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })
})

describe('handlePlacementRequest for several access points', () => {
  it('posts the multi-AP result', () => {
    const messages: PlacementMessage[] = []
    handlePlacementRequest(
      { id: 3, kind: 'place-many', problem: problem(twoRooms(), { add: 2 }) },
      (m) => messages.push(m),
    )
    const last = messages.at(-1)
    expect(last).toMatchObject({ id: 3, kind: 'result-many' })
    if (last?.kind !== 'result-many') throw new Error()
    expect(found(last.result).share).toBe(1)
  })

  it('posts the how-many result', () => {
    const messages: PlacementMessage[] = []
    handlePlacementRequest(
      { id: 4, kind: 'how-many', problem: howMany(twoRooms(), 1) },
      (m) => messages.push(m),
    )
    const last = messages.at(-1)
    expect(last).toMatchObject({ id: 4, kind: 'result-how-many' })
    if (last?.kind !== 'result-how-many') throw new Error()
    expect(reached(last.result).added).toBe(2)
  })
})
