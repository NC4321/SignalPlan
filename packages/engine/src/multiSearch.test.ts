import type { AccessPoint, Floor, Plan } from '@signalplan/floorplan'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  mulberry32,
  searchMultiPlacement,
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
})
