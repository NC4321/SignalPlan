import { describe, expect, it } from 'vitest'
import { addWall, nextId, splitWall } from './edit.ts'
import type { Floor, Plan } from './schema.ts'
import { checkStructure } from './validate.ts'

function emptyFloor(): Floor {
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: [],
    walls: [],
    openings: [],
  }
}

/** Structural checks for a single floor, via the plan validator. */
function valid(floor: Floor) {
  const plan: Plan = {
    schemaVersion: 1,
    name: 't',
    floors: [floor],
    accessPoints: [],
  }
  return checkStructure(plan)
}

/** Walls as "x1,y1-x2,y2 material", for readable expectations. */
function describeWalls(floor: Floor) {
  const at = (id: string) => {
    const n = floor.nodes.find((node) => node.id === id)!
    return `${+n.x.toFixed(3)},${+n.y.toFixed(3)}`
  }
  return floor.walls
    .map((w) => `${at(w.from)}-${at(w.to)} ${w.material}`)
    .sort()
}

const p = (x: number, y: number) => ({ x, y })

describe('nextId', () => {
  it('counts past the highest numbered id with the prefix', () => {
    const floor = emptyFloor()
    floor.nodes.push({ id: 'n7', x: 0, y: 0 }, { id: 'corner', x: 1, y: 0 })
    expect(nextId(floor, 'n')).toBe('n8')
    expect(nextId(floor, 'w')).toBe('w1')
  })
})

describe('addWall', () => {
  it('adds a free-standing wall with two new nodes', () => {
    const floor = emptyFloor()
    expect(addWall(floor, p(0, 0), p(4, 0), 'brick')).toEqual(['w1'])
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick'])
    expect(floor.nodes).toHaveLength(2)
  })

  it('ignores walls shorter than 1 cm', () => {
    const floor = emptyFloor()
    expect(addWall(floor, p(0, 0), p(0.005, 0), 'brick')).toEqual([])
    expect(floor.nodes).toEqual([])
  })

  it('chains walls through a shared corner', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'drywall')
    addWall(floor, p(4, 0), p(4, 3), 'drywall')
    expect(floor.nodes).toHaveLength(3)
    const [first, second] = floor.walls
    expect(first!.to).toBe(second!.from)
  })

  it('splits an existing wall where a new wall ends on it (T)', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    addWall(floor, p(2, 0), p(2, 3), 'drywall')
    expect(describeWalls(floor)).toEqual([
      '0,0-2,0 brick',
      '2,0-2,3 drywall',
      '2,0-4,0 brick',
    ])
    expect(floor.nodes).toHaveLength(4)
    expect(valid(floor)).toEqual([])
  })

  it('splits both walls where they cross (X)', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    addWall(floor, p(2, -2), p(2, 2), 'drywall')
    expect(describeWalls(floor)).toEqual([
      '0,0-2,0 brick',
      '2,-2-2,0 drywall',
      '2,0-2,2 drywall',
      '2,0-4,0 brick',
    ])
    expect(valid(floor)).toEqual([])
  })

  it('handles several crossings in order', () => {
    const floor = emptyFloor()
    addWall(floor, p(1, -1), p(1, 1), 'brick')
    addWall(floor, p(3, -1), p(3, 1), 'brick')
    const created = addWall(floor, p(0, 0), p(4, 0), 'drywall')
    expect(created).toHaveLength(3)
    expect(describeWalls(floor)).toContain('1,0-3,0 drywall')
  })

  it('reuses an existing wall instead of overlapping it', () => {
    const floor = emptyFloor()
    addWall(floor, p(1, 0), p(3, 0), 'brick')
    addWall(floor, p(0, 0), p(4, 0), 'drywall')
    expect(describeWalls(floor)).toEqual([
      '0,0-1,0 drywall',
      '1,0-3,0 brick',
      '3,0-4,0 drywall',
    ])
  })

  it('adds nothing when drawing exactly over an existing wall', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    expect(addWall(floor, p(4, 0), p(0, 0), 'drywall')).toEqual([])
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick'])
  })

  it('reuses the covered part when starting inside an existing wall', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    addWall(floor, p(2, 0), p(6, 0), 'drywall')
    expect(describeWalls(floor)).toEqual([
      '0,0-2,0 brick',
      '2,0-4,0 brick',
      '4,0-6,0 drywall',
    ])
  })

  it('does not join where it crosses inside a doorway', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    floor.openings.push({
      id: 'door',
      wallId: 'w1',
      kind: 'door',
      offsetM: 1.5,
      widthM: 1,
      material: 'wood',
    })
    addWall(floor, p(2, -2), p(2, 2), 'drywall')
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick', '2,-2-2,2 drywall'])
    expect(valid(floor)).toEqual([])
  })

  it('moves a T junction inside a doorway to the door edge', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    floor.openings.push({
      id: 'door',
      wallId: 'w1',
      kind: 'door',
      offsetM: 1.5,
      widthM: 1,
      material: 'wood',
    })
    addWall(floor, p(1.8, 0), p(1.8, 3), 'drywall')
    // 1.8 is nearer the door's start (1.5) than its end (2.5).
    expect(describeWalls(floor)).toContain('0,0-1.5,0 brick')
    expect(describeWalls(floor)).toContain('1.5,0-1.8,3 drywall')
    expect(floor.openings[0]).toMatchObject({ offsetM: 0, widthM: 1 })
    expect(valid(floor)).toEqual([])
  })
})

describe('splitWall', () => {
  function wallWithOpenings(): Floor {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(10, 0), 'brick')
    floor.openings.push(
      {
        id: 'window',
        wallId: 'w1',
        kind: 'window',
        offsetM: 1,
        widthM: 2,
        material: 'glass',
      },
      {
        id: 'door',
        wallId: 'w1',
        kind: 'door',
        offsetM: 6,
        widthM: 1,
        material: 'wood',
      },
    )
    return floor
  }

  it('splits a wall in two, keeping the first id', () => {
    const floor = wallWithOpenings()
    const node = splitWall(floor, 'w1', p(4, 0.2))
    expect(floor.nodes.find((n) => n.id === node)).toMatchObject({ x: 4, y: 0 })
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick', '4,0-10,0 brick'])
    expect(floor.walls[0]!.id).toBe('w1')
  })

  it('moves openings to the half they sit on, with new offsets', () => {
    const floor = wallWithOpenings()
    splitWall(floor, 'w1', p(4, 0))
    expect(floor.openings).toEqual([
      expect.objectContaining({ id: 'window', wallId: 'w1', offsetM: 1 }),
      expect.objectContaining({ id: 'door', wallId: 'w2', offsetM: 2 }),
    ])
    expect(valid(floor)).toEqual([])
  })

  it('moves a split inside an opening to its nearest edge', () => {
    const floor = wallWithOpenings()
    splitWall(floor, 'w1', p(6.8, 0))
    expect(describeWalls(floor)).toEqual(['0,0-7,0 brick', '7,0-10,0 brick'])
    expect(floor.openings[1]).toMatchObject({ wallId: 'w1', offsetM: 6 })
    expect(valid(floor)).toEqual([])
  })

  it('returns the end node instead of splitting at an end', () => {
    const floor = wallWithOpenings()
    expect(splitWall(floor, 'w1', p(-1, 0))).toBe(floor.walls[0]!.from)
    expect(floor.walls).toHaveLength(1)
  })

  it('does not split when the nearest opening edge is the wall end', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(3, 0), 'brick')
    floor.openings.push({
      id: 'door',
      wallId: 'w1',
      kind: 'door',
      offsetM: 2,
      widthM: 1,
      material: 'wood',
    })
    expect(splitWall(floor, 'w1', p(2.8, 0))).toBe(floor.walls[0]!.to)
    expect(floor.walls).toHaveLength(1)
  })
})
