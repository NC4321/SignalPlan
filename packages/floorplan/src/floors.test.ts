import { describe, expect, it } from 'vitest'
import {
  addFloor,
  adjacentFloorId,
  deleteFloor,
  moveFloor,
  SLAB_THICKNESS_M,
  stackedFloors,
} from './floors.ts'
import type { Floor, Plan } from './schema.ts'
import { parsePlan } from './validate.ts'

function floor(id: string, elevationM: number, heightM = 2.4): Floor {
  return {
    id,
    name: id,
    elevationM,
    heightM,
    nodes: [],
    walls: [],
    openings: [],
  }
}

function plan(floors: Floor[]): Plan {
  return {
    schemaVersion: 1,
    name: 'Test',
    floors,
    accessPoints: floors.map((f) => ({
      id: `ap-${f.id}`,
      name: 'AP',
      floorId: f.id,
      x: 0,
      y: 0,
      heightM: 1,
      radios: [{ band: '5GHz' as const }],
    })),
  }
}

describe('stackedFloors', () => {
  it('sorts by elevation and keeps plan order on ties', () => {
    const floors = [floor('b', 2.7), floor('a', 0), floor('c', 0)]
    expect(stackedFloors(floors).map((f) => f.id)).toEqual(['a', 'c', 'b'])
  })
})

describe('addFloor', () => {
  it('stacks a floor above on its own timber slab, copying the height', () => {
    const p = plan([floor('main', 0, 2.5)])
    const id = addFloor(p, 'above')
    const added = p.floors.find((f) => f.id === id)!
    // 0 + 2.5 m ceiling + 0.266 m joist floor.
    expect(added.elevationM).toBeCloseTo(2.766, 12)
    expect(added).toMatchObject({ name: 'Upper floor', heightM: 2.5 })
    expect(added.material).toBeUndefined()
    expect(added.walls).toEqual([])
    expect(parsePlan(p).ok).toBe(true)
  })

  it('puts a basement under the lowest floor, below that floor’s slab', () => {
    const main = { ...floor('main', 0), material: 'concrete-slab' as const }
    const p = plan([main])
    const id = addFloor(p, 'below')
    const added = p.floors.find((f) => f.id === id)!
    // 0 − 0.15 m slab − 2.4 m storey.
    expect(added.elevationM).toBeCloseTo(-2.55, 12)
    expect(added.name).toBe('Basement')
    expect(SLAB_THICKNESS_M['concrete-slab']).toBe(0.15)
  })

  it('gives each new floor an unused id and name', () => {
    const p = plan([floor('main', 0)])
    const a = addFloor(p, 'above')
    const b = addFloor(p, 'above')
    expect(a).not.toBe(b)
    expect(p.floors.map((f) => f.name)).toEqual([
      'main',
      'Upper floor',
      'Upper floor 2',
    ])
    // Each goes on top of the last.
    expect(p.floors[2]!.elevationM).toBeGreaterThan(p.floors[1]!.elevationM)
    expect(parsePlan(p).ok).toBe(true)
  })
})

describe('deleteFloor', () => {
  it('removes the floor and its access points', () => {
    const p = plan([floor('main', 0), floor('up', 2.7)])
    expect(deleteFloor(p, 'up')).toBe(true)
    expect(p.floors.map((f) => f.id)).toEqual(['main'])
    expect(p.accessPoints.map((ap) => ap.id)).toEqual(['ap-main'])
  })

  it('keeps the last floor', () => {
    const p = plan([floor('main', 0)])
    expect(deleteFloor(p, 'main')).toBe(false)
    expect(p.floors).toHaveLength(1)
  })

  it('ignores an unknown floor', () => {
    const p = plan([floor('main', 0), floor('up', 2.7)])
    expect(deleteFloor(p, 'nope')).toBe(false)
    expect(p.floors).toHaveLength(2)
    expect(p.accessPoints).toHaveLength(2)
  })
})

describe('moveFloor', () => {
  it('swaps two floors, keeping the pair’s span and the gap between', () => {
    // main 0–2.4, gap 0.3, up 2.7–5.7 (3 m tall).
    const p = plan([floor('main', 0), floor('up', 2.7, 3)])
    expect(moveFloor(p, 'main', 'up')).toBe(true)
    const [up, main] = stackedFloors(p.floors)
    expect(up!.id).toBe('up')
    expect(up!.elevationM).toBe(0)
    // 3 m + 0.3 m gap.
    expect(main!.elevationM).toBeCloseTo(3.3, 12)
    // Top of the pair unchanged: 3.3 + 2.4 = 5.7.
    expect(main!.elevationM + main!.heightM).toBeCloseTo(5.7, 12)
  })

  it('leaves other floors where they are', () => {
    const p = plan([floor('base', -2.7), floor('main', 0), floor('up', 2.7)])
    expect(moveFloor(p, 'up', 'down')).toBe(true)
    expect(p.floors.find((f) => f.id === 'base')!.elevationM).toBe(-2.7)
    expect(stackedFloors(p.floors).map((f) => f.id)).toEqual([
      'base',
      'up',
      'main',
    ])
  })

  it('refuses past the top or bottom', () => {
    const p = plan([floor('main', 0), floor('up', 2.7)])
    expect(moveFloor(p, 'up', 'up')).toBe(false)
    expect(moveFloor(p, 'main', 'down')).toBe(false)
    expect(p.floors.map((f) => f.elevationM)).toEqual([0, 2.7])
  })
})

describe('adjacentFloorId', () => {
  it('steps up and down the stack, stopping at the ends', () => {
    const floors = [floor('up', 2.7), floor('base', -2.7), floor('main', 0)]
    expect(adjacentFloorId(floors, 'main', 1)).toBe('up')
    expect(adjacentFloorId(floors, 'main', -1)).toBe('base')
    expect(adjacentFloorId(floors, 'up', 1)).toBeUndefined()
    expect(adjacentFloorId(floors, 'base', -1)).toBeUndefined()
    expect(adjacentFloorId(floors, 'nope', 1)).toBeUndefined()
  })
})
