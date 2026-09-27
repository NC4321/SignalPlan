import {
  materialSegments,
  parsePlan,
  type MaterialSegment,
  type Point,
  type WallMaterial,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { crossings, wallLoss } from './crossings.ts'

const LOSS: Record<WallMaterial, number> = {
  drywall: 3,
  brick: 10,
  concrete: 15,
  glass: 2,
  'low-e-glass': 25,
  wood: 4,
  metal: 30,
}
const lossOf = (material: WallMaterial) => LOSS[material]

function segment(
  a: Point,
  b: Point,
  material: WallMaterial,
  wallId = 'w',
): MaterialSegment {
  return { wallId, a, b, material }
}

const p = (x: number, y: number): Point => ({ x, y })

describe('crossings', () => {
  it('finds nothing in free space', () => {
    expect(crossings([], p(0, 0), p(10, 0))).toEqual([])
    expect(wallLoss([], p(0, 0), p(10, 0), lossOf)).toBe(0)
  })

  it('finds one wall across the path', () => {
    const walls = [segment(p(5, -1), p(5, 1), 'brick')]
    const found = crossings(walls, p(0, 0), p(10, 0))
    expect(found).toHaveLength(1)
    expect(found[0]?.t).toBeCloseTo(0.5)
    expect(wallLoss(walls, p(0, 0), p(10, 0), lossOf)).toBe(10)
  })

  it('finds two walls in order along the path', () => {
    const walls = [
      segment(p(7, -1), p(7, 1), 'concrete', 'far'),
      segment(p(2, -1), p(2, 1), 'drywall', 'near'),
    ]
    const found = crossings(walls, p(0, 0), p(10, 0))
    expect(found.map((c) => c.segments[0]?.wallId)).toEqual(['near', 'far'])
    expect(wallLoss(walls, p(0, 0), p(10, 0), lossOf)).toBe(18)
  })

  it('ignores walls that the path does not reach', () => {
    const walls = [
      segment(p(5, 1), p(5, 3), 'brick'), // beside the path
      segment(p(12, -1), p(12, 1), 'brick'), // beyond its end
      segment(p(-2, -1), p(-2, 1), 'brick'), // behind its start
    ]
    expect(crossings(walls, p(0, 0), p(10, 0))).toEqual([])
  })

  it('ignores a path running along a wall', () => {
    const walls = [segment(p(2, 0), p(8, 0), 'metal')]
    expect(crossings(walls, p(0, 0), p(10, 0))).toEqual([])
  })

  it('works for diagonal paths in either direction', () => {
    const walls = [segment(p(0, 4), p(4, 0), 'wood')]
    expect(wallLoss(walls, p(0, 0), p(4, 4), lossOf)).toBe(4)
    expect(wallLoss(walls, p(4, 4), p(0, 0), lossOf)).toBe(4)
  })

  it('counts a path ending exactly on a wall', () => {
    const walls = [segment(p(5, -1), p(5, 1), 'brick')]
    expect(wallLoss(walls, p(0, 0), p(5, 0), lossOf)).toBe(10)
  })

  it('counts a corner once, using the lossier wall', () => {
    const walls = [
      segment(p(0, 0), p(5, 0), 'drywall', 'a'),
      segment(p(5, 0), p(5, 5), 'brick', 'b'),
    ]
    const found = crossings(walls, p(4, -1), p(6, 1))
    expect(found).toHaveLength(1)
    expect(found[0]?.segments).toHaveLength(2)
    expect(wallLoss(walls, p(4, -1), p(6, 1), lossOf)).toBe(10)
  })

  it('counts the edge between a wall and its door once', () => {
    const floor = {
      id: 'f',
      name: '',
      elevationM: 0,
      heightM: 2.5,
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 0, y: 4 },
      ],
      walls: [{ id: 'w', from: 'a', to: 'b', material: 'brick' as const }],
      openings: [
        {
          id: 'd',
          wallId: 'w',
          kind: 'door' as const,
          offsetM: 2,
          widthM: 1,
          material: 'wood' as const,
        },
      ],
    }
    const walls = materialSegments(floor)
    // Through the door, exactly on its edge, and through solid wall.
    expect(wallLoss(walls, p(-1, 2.5), p(1, 2.5), lossOf)).toBe(4)
    expect(crossings(walls, p(-1, 2), p(1, 2))).toHaveLength(1)
    expect(wallLoss(walls, p(-1, 1), p(1, 1), lossOf)).toBe(10)
  })

  it('handles a zero-length path', () => {
    const walls = [segment(p(5, -1), p(5, 1), 'brick')]
    expect(crossings(walls, p(5, 0), p(5, 0))).toEqual([])
  })
})

describe('crossings in the sample home', () => {
  const result = parsePlan(sampleHome)
  if (!result.ok) throw new Error('fixture is invalid')
  const floor = result.plan.floors[0]!
  const walls = materialSegments(floor)
  const router = result.plan.accessPoints[0]!

  const crossed = (to: { x: number; y: number }) =>
    crossings(walls, router, to).flatMap((c) =>
      c.segments.map((s) => `${s.wallId}:${s.material}`),
    )

  it('finds no walls within the open-plan living area', () => {
    expect(crossed(p(9, 8))).toEqual([])
  })

  it('finds the drywall into the office', () => {
    expect(crossed(p(13, 2))).toEqual(['living-office:drywall'])
  })

  it('finds the concrete into the utility room', () => {
    expect(crossed(p(13, 5.5))).toEqual(['living-utility:concrete'])
  })

  it('finds the bedroom wall, then the brick, when leaving the house', () => {
    expect(crossed(p(-2, 1.2))).toEqual([
      'living-bed1:drywall',
      'ext-left-bed1:brick',
    ])
  })
})
