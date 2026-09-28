import type { AccessPoint, Floor, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { FLOOR_LOSS_DB } from './materials.ts'
import { searchHowMany, searchMultiPlacement } from './multiSearch.ts'
import { candidatePositions, createScorer } from './placement.ts'
import { searchSinglePlacement } from './search.ts'
import { ap, freeSpaceDbm, room } from './testPlans.ts'

/**
 * Whole-home placement (D55): a 4 × 4 m room on the ground floor ('f') and
 * another straight above it ('up', floor at 2.65 m) over a concrete slab.
 * From a room's centre its corners are 2.83 m away, so a reach of 2.9 m
 * covers a room from its middle. Through the slab (20.2 dB on 5 GHz) and at
 * least 2.65 m up, an access point never reaches the other floor, so each
 * floor needs its own.
 */
const reach = freeSpaceDbm(2.9)
const upstairs = (withWalls = true): Floor => ({
  ...room(4, 4),
  ...(withWalls ? {} : { nodes: [], walls: [] }),
  id: 'up',
  name: 'Upstairs',
  elevationM: 2.65,
  material: 'concrete-slab',
})
const home = (accessPoints: AccessPoint[] = [], up = upstairs()): Plan => ({
  schemaVersion: 1,
  name: 'Two rooms, one above the other',
  floors: [room(4, 4), up],
  accessPoints,
})
const base = (plan: Plan, fixed: AccessPoint[] = []) => ({
  plan,
  band: '5GHz' as const,
  minDbm: reach,
  fixed,
  template: { heightM: 1, radios: [{ band: '5GHz' as const }] },
})
const onUp = (a: AccessPoint): AccessPoint => ({ ...a, floorId: 'up' })

describe('whole-home scorer (D55)', () => {
  it('scores both floors by area, lowest first', () => {
    // The slab really does stop the signal at this target.
    expect(FLOOR_LOSS_DB['5GHz']['concrete-slab']).toBeGreaterThan(20)
    const scorer = createScorer(base(home()))!
    expect(scorer.floors.map((f) => f.floorId)).toEqual(['f', 'up'])
    expect(scorer.areaM2).toBeCloseTo(32, 9)
    const downstairs = [scorer.signal({ x: 2, y: 2, floorId: 'f' })]
    expect(scorer.share(downstairs)).toBe(0.5)
    expect(scorer.floorShares(downstairs)).toEqual([1, 0])
    const both = [...downstairs, scorer.signal({ x: 2, y: 2, floorId: 'up' })]
    expect(scorer.floorShares(both)).toEqual([1, 1])
    // Candidates on each floor, from the lowest up.
    const spots = candidatePositions(scorer)
    expect(spots[0]!.floorId).toBe('f')
    expect(spots.at(-1)!.floorId).toBe('up')
    expect(spots.filter((s) => s.floorId === 'up')).toHaveLength(64)
  })

  it('leaves out a floor with no closed outline', () => {
    const scorer = createScorer(base(home([], upstairs(false))))!
    expect(scorer.floors.map((f) => f.floorId)).toEqual(['f'])
    expect(scorer.allows({ x: 2, y: 2, floorId: 'up' })).toBe(false)
  })
})

describe('searches across floors (D55)', () => {
  it('keeps an access point that moves on its own floor', () => {
    const router = ap(0.5, 0.5)
    const result = searchSinglePlacement({
      ...base(home([router])),
      current: router,
    })
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.position.floorId).toBe('f')
    expect(result.share).toBe(0.5)
    expect(result.floors).toEqual([
      { floorId: 'f', before: expect.any(Number), share: 1 },
      { floorId: 'up', before: 0, share: 0 },
    ])
    expect(result.floors[0]!.before).toBeLessThan(1)
  })

  it('puts a new access point on the floor that needs it', () => {
    const router = ap(2, 2)
    const result = searchSinglePlacement(base(home([router]), [router]))
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.position.floorId).toBe('up')
    expect(result.share).toBe(1)
    expect(result.floors.map((f) => f.before)).toEqual([undefined, undefined])
  })

  it('adds one more upstairs and keeps the router downstairs', () => {
    const router = ap(0.5, 0.5)
    const result = searchMultiPlacement({
      ...base(home([router])),
      moving: [router],
      add: 1,
    })
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.positions.map((p) => p.floorId)).toEqual(['f', 'up'])
    expect(result.share).toBe(1)
    expect(result.floors.map((f) => f.share)).toEqual([1, 1])
    expect(result.floors[1]!.before).toBe(0)
  })

  it('counts one more for the whole home', () => {
    const router = ap(2, 2)
    const result = searchHowMany({
      ...base(home([router])),
      moving: [router],
      goal: 1,
    })
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result).toMatchObject({ added: 1, reached: true, share: 1 })
    expect(result.positions[1]!.floorId).toBe('up')
  })

  it('moves access points on both floors together', () => {
    const down = ap(0.5, 0.5)
    const up = onUp(ap(3.5, 3.5))
    const result = searchMultiPlacement({
      ...base(home([down, up])),
      moving: [down, up],
      add: 0,
    })
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.positions.map((p) => p.floorId)).toEqual(['f', 'up'])
    expect(result.before).toBeLessThan(1)
    expect(result.share).toBe(1)
  })

  it('leaves an access point where it is on a floor with no outline', () => {
    const down = ap(0.5, 0.5)
    const up = onUp(ap(3, 3))
    const result = searchMultiPlacement({
      ...base(home([down, up], upstairs(false))),
      moving: [down, up],
      add: 0,
    })
    if (result.kind !== 'found') throw new Error(result.kind)
    expect(result.positions[1]).toEqual({ x: 3, y: 3, floorId: 'up' })
    expect(result.positions[0]!.floorId).toBe('f')
    expect(result.share).toBe(1)
  })
})
