import { describe, expect, it } from 'vitest'
import { createScorer } from './placement.ts'
import { searchSinglePlacement } from './search.ts'
import { gateHomes, naiveCentre, room } from './testPlans.ts'

/**
 * The M2 exit gate (OUTLINE Phase 4, D47): on three test homes, the
 * suggested spot for the router beats a naive centre placement. Compared at
 * Good (−60 dBm) on 5 GHz, where a centre router falls short in each home;
 * a strictly larger share of the floor counts as beating it.
 */
const GOOD_DBM = -60

describe('optimizer exit gate', () => {
  const homes = gateHomes()

  it('has three homes of different sizes', () => {
    const areas = homes.map(({ plan }) => {
      const router = plan.accessPoints[0]!
      return createScorer({
        plan,
        band: '5GHz',
        minDbm: GOOD_DBM,
        fixed: [],
        template: router,
      })!.areaM2
    })
    expect(areas.map(Math.round)).toEqual([150, 65, 220])
  })

  for (const { name, plan } of homes) {
    it(`beats the centre on the ${name}`, () => {
      const router = plan.accessPoints[0]!
      const problem = {
        plan,
        band: '5GHz' as const,
        minDbm: GOOD_DBM,
        fixed: [],
        template: router,
      }
      // The centre on the same 10 cm cells the suggestion is confirmed on.
      const fine = createScorer({ ...problem, cellM: 0.1 })!
      const centre = naiveCentre(plan, router.floorId, fine)
      const atCentre = fine.score([fine.signal(centre, router)])

      const result = searchSinglePlacement({
        ...problem,
        current: { x: router.x, y: router.y, floorId: router.floorId },
      })
      if (result.kind !== 'found') throw new Error(result.kind)
      expect(result.stoppedEarly).toBe(false)
      expect(result.share).toBeGreaterThan(atCentre.share)
    })
  }
})

describe('naiveCentre', () => {
  it('is the middle of the bounding box when that is allowed', () => {
    const floor = room(8, 4)
    const plan = { floors: [floor] } as Parameters<typeof naiveCentre>[0]
    const scorer = createScorer({
      plan,
      band: '5GHz',
      minDbm: GOOD_DBM,
      fixed: [],
      template: { heightM: 1, radios: [{ band: '5GHz' }] },
    })!
    expect(naiveCentre(plan, floor.id, scorer)).toEqual({
      x: 4,
      y: 2,
      floorId: floor.id,
    })
  })

  it('moves off a wall to the nearest allowed spot', () => {
    // A split at x = 4 puts the middle on a wall. The lattice is at
    // 0.05 + 0.1k, so x = 3.95 and 4.05 are within the 10 cm clearance and
    // the nearest allowed spots are 0.15 m away; y = 1.95 and 2.05 tie, and
    // reading order keeps 1.95.
    const floor = room(8, 4, { x: 4, material: 'drywall' })
    const plan = { floors: [floor] } as Parameters<typeof naiveCentre>[0]
    const scorer = createScorer({
      plan,
      band: '5GHz',
      minDbm: GOOD_DBM,
      fixed: [],
      template: { heightM: 1, radios: [{ band: '5GHz' }] },
    })!
    const centre = naiveCentre(plan, floor.id, scorer)
    expect(Math.abs(centre.x - 4)).toBeCloseTo(0.15, 6)
    expect(centre.y).toBeCloseTo(1.95, 6)
  })
})
