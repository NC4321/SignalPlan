import { describe, expect, it } from 'vitest'
import {
  addFloorOpening,
  deleteFloorOpening,
  moveFloorOpening,
  moveFloorOpeningCorner,
} from './floorOpenings.ts'
import { pointInPolygon, polygonArea } from './geometry.ts'
import type { Floor, Plan } from './schema.ts'
import { checkStructure } from './validate.ts'

const emptyFloor = (): Floor => ({
  id: 'f1',
  name: 'Ground',
  elevationM: 0,
  heightM: 2.5,
  nodes: [],
  walls: [],
  openings: [],
})

const square = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 3 },
  { x: 0, y: 3 },
]

describe('polygon geometry', () => {
  it('works out the area of a 2 × 3 m rectangle either way round', () => {
    expect(polygonArea(square)).toBeCloseTo(6)
    expect(polygonArea([...square].reverse())).toBeCloseTo(6)
  })

  it('finds points inside an L shape and not in its notch', () => {
    // 4 × 4 m with the top-right 2 × 2 m cut out.
    const l = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    expect(polygonArea(l)).toBeCloseTo(12)
    expect(pointInPolygon({ x: 1, y: 1 }, l)).toBe(true)
    expect(pointInPolygon({ x: 3, y: 3 }, l)).toBe(true)
    expect(pointInPolygon({ x: 3, y: 1 }, l)).toBe(false)
    expect(pointInPolygon({ x: -1, y: 1 }, l)).toBe(false)
  })
})

describe('floor openings', () => {
  it('adds openings with fresh ids and copies the corners', () => {
    const floor = emptyFloor()
    const points = square.map((p) => ({ ...p }))
    expect(addFloorOpening(floor, points)).toBe('hole1')
    expect(addFloorOpening(floor, square)).toBe('hole2')
    points[0]!.x = 9
    expect(floor.floorOpenings?.[0]?.points[0]).toEqual({ x: 0, y: 0 })
  })

  it('refuses fewer than three corners or almost no area', () => {
    const floor = emptyFloor()
    expect(addFloorOpening(floor, square.slice(0, 2))).toBeUndefined()
    const sliver = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0.001 },
    ]
    expect(addFloorOpening(floor, sliver)).toBeUndefined()
    expect(floor.floorOpenings).toBeUndefined()
  })

  it('moves a whole opening and one corner', () => {
    const floor = emptyFloor()
    const id = addFloorOpening(floor, square)!
    moveFloorOpening(floor, id, 1, -1)
    expect(floor.floorOpenings?.[0]?.points[2]).toEqual({ x: 3, y: 2 })
    expect(moveFloorOpeningCorner(floor, id, 2, { x: 5, y: 5 })).toBe(true)
    expect(floor.floorOpenings?.[0]?.points[2]).toEqual({ x: 5, y: 5 })
  })

  it("won't move a corner so the opening loses its area", () => {
    const floor = emptyFloor()
    const triangle = square.slice(0, 3)
    const id = addFloorOpening(floor, triangle)!
    // Onto the line through the other two corners.
    expect(moveFloorOpeningCorner(floor, id, 2, { x: 4, y: 0 })).toBe(false)
    expect(floor.floorOpenings?.[0]?.points[2]).toEqual({ x: 2, y: 3 })
  })

  it('deletes an opening and drops the empty list', () => {
    const floor = emptyFloor()
    const id = addFloorOpening(floor, square)!
    expect(deleteFloorOpening(floor, 'nope')).toBe(false)
    expect(deleteFloorOpening(floor, id)).toBe(true)
    expect(floor.floorOpenings).toBeUndefined()
  })

  it('validation reports duplicate ids and openings with no area', () => {
    const floor = emptyFloor()
    floor.floorOpenings = [
      { id: 'a', points: square },
      { id: 'a', points: square },
      {
        id: 'b',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      },
    ]
    const plan: Plan = {
      schemaVersion: 1,
      name: 'p',
      floors: [floor],
      accessPoints: [],
    }
    expect(checkStructure(plan).map((i) => i.path)).toEqual([
      'floors[0].floorOpenings[1].id',
      'floors[0].floorOpenings[2]',
    ])
  })
})
