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
import { createScorer } from './placement.ts'
import { searchSinglePlacement, type SinglePlacementProblem } from './search.ts'
import { bigHouse, roomGrid } from './testPlans.ts'
import { handlePlacementRequest, type PlacementMessage } from './worker.ts'

/** A drywall outline of a w × h room, optionally split at x = splitX. */
function room(
  w: number,
  h: number,
  split?: { x: number; material: WallMaterial },
): Floor {
  const corners = split
    ? [
        [0, 0],
        [split.x, 0],
        [w, 0],
        [w, h],
        [split.x, h],
        [0, h],
      ]
    : [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]
  const walls = corners.map((_, i) => ({
    id: `w${i}`,
    from: `n${i}`,
    to: `n${(i + 1) % corners.length}`,
    material: 'drywall' as WallMaterial,
  }))
  if (split) {
    walls.push({ id: 'split', from: 'n1', to: 'n4', material: split.material })
  }
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: corners.map(([x, y], i) => ({ id: `n${i}`, x: x!, y: y! })),
    walls,
    openings: [],
  }
}

/** An access point at receiver height, so distances are flat. */
const ap = (x: number, y: number): AccessPoint => ({
  id: `ap-${x}-${y}`,
  name: 'AP',
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
): SinglePlacementProblem {
  return {
    plan: {
      schemaVersion: 1,
      id: 'p',
      name: 'Plan',
      floors: [floor],
      accessPoints: fixed,
    } as Plan,
    floorId: 'f',
    band: '5GHz',
    minDbm,
    fixed,
    template: { heightM: 1, radios: [{ band: '5GHz' }] },
  }
}

describe('searchSinglePlacement', () => {
  it('puts it in the middle of a square room', () => {
    // Reach of 2.2 m can't cover the corners (2.8 m from the centre), and by
    // symmetry the centre covers the most. The lattice has no point at
    // (2, 2); refining finds it.
    const result = searchSinglePlacement(problem(room(4, 4), freeSpaceDbm(2.2)))
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.position.x).toBeCloseTo(2, 6)
    expect(result.position.y).toBeCloseTo(2, 6)
    expect(result.share).toBeLessThan(1)
  })

  it('breaks a tie at 100% by the strongest weakest spot', () => {
    // At −90 dBm every spot covers the whole 4 × 2 room, so the share ties
    // everywhere. The weakest cell is a far corner, and it's strongest with
    // the access point in the middle.
    const result = searchSinglePlacement(problem(room(4, 2), -90))
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.share).toBe(1)
    expect(result.position.x).toBeCloseTo(2, 6)
    expect(result.position.y).toBeCloseTo(1, 6)
  })

  it('goes behind a metal wall to the room the fixed one misses', () => {
    // A fixed access point in the middle of the 4 × 4 left room reaches its
    // corners (2.8 m) at a 3 m target; the metal wall blocks the 2 × 4 right
    // room, which is covered from anywhere inside it (at most 2.9 m across).
    const result = searchSinglePlacement(
      problem(room(6, 4, { x: 4, material: 'metal' }), freeSpaceDbm(3), [
        ap(2, 2),
      ]),
    )
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.position.x).toBeGreaterThan(4)
    expect(result.share).toBe(1)
  })

  it('reports the share and weakest spot at the current spot too', () => {
    const p = { ...problem(room(4, 4), freeSpaceDbm(2.2)), current: ap(1, 1) }
    const result = searchSinglePlacement(p)
    if (result.kind !== 'found') throw new Error(result.kind)
    const fine = createScorer({ ...p, cellM: 0.1 })!
    const there = fine.score([fine.signal({ x: 1, y: 1 })])
    expect(result.before).toBe(there.share)
    expect(result.beforeWeakestDbm).toBe(there.weakestDbm)
    expect(result.before).toBeLessThan(result.share)
    expect(result.beforeWeakestDbm).toBeLessThan(result.weakestDbm)
  })

  it('stops at the time budget with the best so far', () => {
    let t = 0
    const result = searchSinglePlacement(
      problem(room(4, 4), freeSpaceDbm(2.2)),
      { budgetMs: 5, now: () => t++ },
    )
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.stoppedEarly).toBe(true)
    const scorer = createScorer(problem(room(4, 4), -67))!
    expect(scorer.allows(result.position)).toBe(true)
  })

  it('reports progress up to 1, never going back', () => {
    const seen: number[] = []
    searchSinglePlacement(problem(room(3, 3), freeSpaceDbm(2)), {
      onProgress: (f) => seen.push(f),
    })
    expect(seen.length).toBeGreaterThan(10)
    expect(seen.at(-1)).toBe(1)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!)
    }
  })

  it('says why when there is nothing to search', () => {
    const open = room(4, 4)
    open.walls.pop()
    expect(searchSinglePlacement(problem(open, -67)).kind).toBe('no-floor-area')
    const noRadio = {
      ...problem(room(4, 4), -67),
      template: { heightM: 1, radios: [{ band: '6GHz' as const }] },
    }
    expect(searchSinglePlacement(noRadio).kind).toBe('no-radio')
  })

  it('beats a centre placement on the test homes', () => {
    const result = parsePlan(sampleHome)
    if (!result.ok) throw new Error('fixture is invalid')
    for (const plan of [result.plan, roomGrid(), bigHouse()]) {
      const floor = plan.floors[0]!
      const router = plan.accessPoints[0]!
      const p: SinglePlacementProblem = {
        plan,
        floorId: floor.id,
        band: '5GHz',
        minDbm: -67,
        fixed: [],
        template: router,
      }
      // The naive spot: the middle of the walls' bounding box.
      const xs = floor.nodes.map((n) => n.x)
      const ys = floor.nodes.map((n) => n.y)
      const centre = {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      }
      const found = searchSinglePlacement(
        { ...p, current: centre },
        { budgetMs: Infinity },
      )
      if (found.kind !== 'found') throw new Error(found.kind)
      expect(found.share).toBeGreaterThanOrEqual(found.before!)
    }
  }, 60_000)
})

describe('handlePlacementRequest', () => {
  it('posts progress, then the result', () => {
    const messages: PlacementMessage[] = []
    let t = 0
    handlePlacementRequest(
      { id: 7, kind: 'place-one', problem: problem(room(3, 3), -67) },
      (m) => messages.push(m),
      () => (t += 50),
    )
    expect(messages.every((m) => m.id === 7)).toBe(true)
    expect(messages.some((m) => m.kind === 'progress')).toBe(true)
    const last = messages.at(-1)!
    expect(last.kind).toBe('result')
  })

  it('posts an error for a floor that is not there', () => {
    const messages: PlacementMessage[] = []
    const p = { ...problem(room(3, 3), -67), floorId: 'missing' }
    handlePlacementRequest({ id: 1, kind: 'place-one', problem: p }, (m) =>
      messages.push(m),
    )
    expect(messages).toEqual([
      { id: 1, kind: 'error', message: 'No floor with id "missing".' },
    ])
  })
})
