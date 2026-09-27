import { describe, expect, it } from 'vitest'
import sampleHome from '../fixtures/sample-home.json' with { type: 'json' }
import { materialSegments, openingSpans } from './geometry.ts'
import type { Floor } from './schema.ts'
import { parsePlan } from './validate.ts'

/** One 5 m wall along the x axis, with the given openings. */
function wallWith(openings: Floor['openings']): Floor {
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 5, y: 0 },
    ],
    walls: [{ id: 'w', from: 'a', to: 'b', material: 'brick' }],
    openings,
  }
}

const summary = (floor: Floor) =>
  materialSegments(floor).map((s) => [s.a.x, s.b.x, s.material, s.openingId])

describe('materialSegments', () => {
  it('returns a wall without openings as one segment', () => {
    expect(summary(wallWith([]))).toEqual([[0, 5, 'brick', undefined]])
  })

  it('splits a wall around a door', () => {
    const floor = wallWith([
      {
        id: 'd',
        wallId: 'w',
        kind: 'door',
        offsetM: 1,
        widthM: 1,
        material: 'wood',
      },
    ])
    expect(summary(floor)).toEqual([
      [0, 1, 'brick', undefined],
      [1, 2, 'wood', 'd'],
      [2, 5, 'brick', undefined],
    ])
  })

  it('orders openings along the wall regardless of input order', () => {
    const floor = wallWith([
      {
        id: 'late',
        wallId: 'w',
        kind: 'window',
        offsetM: 3,
        widthM: 1,
        material: 'glass',
      },
      {
        id: 'early',
        wallId: 'w',
        kind: 'door',
        offsetM: 0,
        widthM: 1,
        material: 'wood',
      },
    ])
    expect(summary(floor)).toEqual([
      [0, 1, 'wood', 'early'],
      [1, 3, 'brick', undefined],
      [3, 4, 'glass', 'late'],
      [4, 5, 'brick', undefined],
    ])
  })

  it('leaves a gap for open doorways', () => {
    const floor = wallWith([
      {
        id: 'arch',
        wallId: 'w',
        kind: 'door',
        offsetM: 4,
        widthM: 1,
        material: 'open',
      },
    ])
    expect(summary(floor)).toEqual([[0, 4, 'brick', undefined]])
  })

  it('follows the wall direction for diagonal walls', () => {
    const floor = wallWith([
      {
        id: 'd',
        wallId: 'w',
        kind: 'door',
        offsetM: 2.5,
        widthM: 2.5,
        material: 'wood',
      },
    ])
    floor.nodes[1] = { id: 'b', x: 3, y: 4 }
    const door = materialSegments(floor).find((s) => s.openingId === 'd')
    expect(door?.a.x).toBeCloseTo(1.5)
    expect(door?.a.y).toBeCloseTo(2)
    expect(door?.b).toEqual({ x: 3, y: 4 })
  })

  it('covers every wall of the sample home end to end', () => {
    const result = parsePlan(sampleHome)
    if (!result.ok) throw new Error('fixture is invalid')
    const floor = result.plan.floors[0]!
    const wallLength = (id: string) => {
      const wall = floor.walls.find((w) => w.id === id)!
      const from = floor.nodes.find((n) => n.id === wall.from)!
      const to = floor.nodes.find((n) => n.id === wall.to)!
      return Math.hypot(to.x - from.x, to.y - from.y)
    }
    const total = (segments: ReturnType<typeof materialSegments>) =>
      segments.reduce(
        (sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y),
        0,
      )

    const expected = floor.walls.reduce((sum, w) => sum + wallLength(w.id), 0)
    expect(total(materialSegments(floor))).toBeCloseTo(expected, 9)
  })
})

describe('openingSpans', () => {
  it('places every opening, including open doorways, on the plan', () => {
    const floor = wallWith([
      {
        id: 'd',
        wallId: 'w',
        kind: 'door',
        offsetM: 1,
        widthM: 1,
        material: 'open',
      },
    ])
    expect(openingSpans(floor)).toEqual([
      {
        id: 'd',
        wallId: 'w',
        kind: 'door',
        material: 'open',
        a: { x: 1, y: 0 },
        b: { x: 2, y: 0 },
      },
    ])
  })
})
