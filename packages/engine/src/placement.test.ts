import {
  parsePlan,
  type AccessPoint,
  type Floor,
  type Plan,
  type WallMaterial,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES } from './bands.ts'
import { evaluateCoverage } from './coverage.ts'
import { summariseCoverage } from './floorArea.ts'
import { MATERIAL_LOSS_DB } from './materials.ts'
import {
  candidatePositions,
  createScorer,
  type PlacementProblem,
} from './placement.ts'

/**
 * Rooms side by side, each 2 m square, from x = 0: a 4 × 2 m outline in
 * drywall, split at x = 2 by a partition of the given material.
 */
function twoRooms(partition: WallMaterial): Floor {
  const corners = [
    [0, 0],
    [2, 0],
    [4, 0],
    [4, 2],
    [2, 2],
    [0, 2],
  ]
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: corners.map(([x, y], i) => ({ id: `n${i}`, x: x!, y: y! })),
    walls: [
      ...corners.map((_, i) => ({
        id: `w${i}`,
        from: `n${i}`,
        to: `n${(i + 1) % corners.length}`,
        material: 'drywall' as const,
      })),
      { id: 'partition', from: 'n1', to: 'n4', material: partition },
    ],
    openings: [],
  }
}

function plan(floor: Floor, accessPoints: AccessPoint[] = []): Plan {
  return {
    schemaVersion: 1,
    id: 'p',
    name: 'Plan',
    floors: [floor],
    accessPoints,
  } as Plan
}

/** An access point at receiver height, so distances are flat. */
const ap = (id: string, x: number, y: number): AccessPoint => ({
  id,
  name: id,
  floorId: 'f',
  x,
  y,
  heightM: 1,
  radios: [{ band: '5GHz' }],
})

/** Free-space signal at distance d on 5 GHz at the default power. */
function freeSpaceDbm(d: number): number {
  const p = BAND_PROFILES['5GHz']
  return (
    p.defaultTxPowerDbm -
    p.referenceLossDb -
    10 * p.pathLossExponent * Math.log10(Math.max(d, 1))
  )
}

function problem(
  floor: Floor,
  minDbm: number,
  fixed: AccessPoint[] = [],
): PlacementProblem {
  return {
    plan: plan(floor, fixed),
    floorId: 'f',
    band: '5GHz',
    minDbm,
    fixed,
    template: { heightM: 1, radios: [{ band: '5GHz' }] },
  }
}

describe('createScorer', () => {
  it('has no scorer until the outline is closed', () => {
    const floor = twoRooms('drywall')
    floor.walls = floor.walls.filter((w) => w.id !== 'w5')
    floor.walls = floor.walls.filter((w) => w.id !== 'partition')
    expect(createScorer(problem(floor, -67))).toBeUndefined()
  })

  it('counts the 8 m² inside the walls at 25 cm cells', () => {
    const scorer = createScorer(problem(twoRooms('drywall'), -67))!
    // 16 × 8 cells of 0.0625 m², none with its centre on a wall.
    expect(scorer.cellCount).toBe(128)
    expect(scorer.areaM2).toBeCloseTo(8, 9)
  })

  it('covers exactly the room behind no metal wall', () => {
    // In the left room, the farthest cell centre from (1, 1) is a corner
    // cell at (0.125, 0.125), 1.24 m away. The nearest right-room cell is
    // 1.125 m away behind the metal partition, which costs far more than
    // the gap in distance. A target set at 1.3 m in free space is reached
    // by all 64 left cells and none of the 64 right ones.
    const metal = MATERIAL_LOSS_DB['5GHz'].metal
    expect(freeSpaceDbm(1.125) - metal).toBeLessThan(freeSpaceDbm(1.3))
    const scorer = createScorer(problem(twoRooms('metal'), freeSpaceDbm(1.3)))!
    expect(scorer.share([scorer.signal({ x: 1, y: 1 })])).toBe(0.5)
    expect(scorer.share([scorer.signal({ x: 3, y: 1 })])).toBe(0.5)
    // Two moving access points, one per room, cover it all.
    expect(
      scorer.share([
        scorer.signal({ x: 1, y: 1 }),
        scorer.signal({ x: 3, y: 1 }),
      ]),
    ).toBe(1)
  })

  it('adds fixed access points to every placement', () => {
    const scorer = createScorer(
      problem(twoRooms('metal'), freeSpaceDbm(1.3), [ap('fixed', 3, 1)]),
    )!
    expect(scorer.share([])).toBe(0.5)
    expect(scorer.share([scorer.signal({ x: 1, y: 1 })])).toBe(1)
  })

  it('ignores a template with no radio in the band', () => {
    const p = problem(twoRooms('metal'), freeSpaceDbm(1.3), [ap('f1', 3, 1)])
    const scorer = createScorer({
      ...p,
      template: { heightM: 1, radios: [{ band: '6GHz' }] },
    })!
    expect(scorer.signal({ x: 1, y: 1 })).toHaveLength(0)
    expect(scorer.share([scorer.signal({ x: 1, y: 1 })])).toBe(0.5)
  })

  it('agrees with the coverage summary on the sample home', () => {
    const result = parsePlan(sampleHome)
    if (!result.ok) throw new Error('fixture is invalid')
    const home = result.plan
    const floorId = home.floors[0]!.id
    const router = home.accessPoints[0]!
    const scorer = createScorer({
      plan: home,
      floorId,
      band: '5GHz',
      minDbm: -67,
      fixed: [],
      template: router,
    })!
    const coverage = evaluateCoverage(home, floorId, '5GHz', 0.25)
    const summary = summariseCoverage(coverage, -67)
    expect(scorer.areaM2).toBeCloseTo(summary.areaM2, 9)
    expect(scorer.share([scorer.signal(router)])).toBeCloseTo(summary.share!, 9)
  })
})

describe('candidatePositions', () => {
  it('tries every half metre inside the walls, clear of them', () => {
    const scorer = createScorer(problem(twoRooms('drywall'), -67))!
    const points = candidatePositions(scorer)
    // x = 0.25 … 3.75 and y = 0.25 … 1.75: 8 × 4, all 0.25 m from walls.
    expect(points).toHaveLength(32)
    expect(points[0]).toEqual({ x: 0.25, y: 0.25 })
    expect(points.at(-1)).toEqual({ x: 3.75, y: 1.75 })
  })

  it('refuses positions outside, on or against a wall', () => {
    const scorer = createScorer(problem(twoRooms('drywall'), -67))!
    expect(scorer.allows({ x: 1, y: 1 })).toBe(true)
    expect(scorer.allows({ x: 1.85, y: 1 })).toBe(true)
    expect(scorer.allows({ x: 1.95, y: 1 })).toBe(false)
    expect(scorer.allows({ x: 2, y: 1 })).toBe(false)
    expect(scorer.allows({ x: -0.5, y: 1 })).toBe(false)
    expect(scorer.allows({ x: 9, y: 9 })).toBe(false)
  })
})
