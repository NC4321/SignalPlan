import { describe, expect, it } from 'vitest'
import {
  addWall,
  collapseShortWalls,
  deleteNode,
  deleteWall,
  fitOpenings,
  joinNode,
  moveNodes,
  setWallLength,
} from './edit.ts'
import type { Floor, Opening, Plan } from './schema.ts'
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

function valid(floor: Floor) {
  const plan: Plan = {
    schemaVersion: 1,
    name: 't',
    floors: [floor],
    accessPoints: [],
  }
  return checkStructure(plan)
}

function describeWalls(floor: Floor) {
  const at = (id: string) => {
    const n = floor.nodes.find((node) => node.id === id)!
    return `${+n.x.toFixed(3)},${+n.y.toFixed(3)}`
  }
  return floor.walls
    .map((w) => {
      const ends = [at(w.from), at(w.to)].sort()
      return `${ends[0]}-${ends[1]} ${w.material}`
    })
    .sort()
}

const p = (x: number, y: number) => ({ x, y })
const nodeAtPoint = (floor: Floor, x: number, y: number) =>
  floor.nodes.find((n) => n.x === x && n.y === y)!.id

function opening(
  id: string,
  wallId: string,
  offsetM: number,
  widthM: number,
): Opening {
  return { id, wallId, kind: 'door', offsetM, widthM, material: 'wood' }
}

/** An L of two walls: (0,0)–(4,0) brick and (4,0)–(4,3) drywall. */
function corner(): Floor {
  const floor = emptyFloor()
  addWall(floor, p(0, 0), p(4, 0), 'brick')
  addWall(floor, p(4, 0), p(4, 3), 'drywall')
  return floor
}

describe('fitOpenings', () => {
  it('slides an opening back inside a shortened wall', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(2, 0), 'brick')
    floor.openings.push(opening('d', 'w1', 1.5, 0.8))
    fitOpenings(floor, 'w1')
    expect(floor.openings[0]).toMatchObject({ offsetM: 1.2, widthM: 0.8 })
  })

  it('pushes overlapping openings apart', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    floor.openings.push(opening('a', 'w1', 1, 1), opening('b', 'w1', 1.5, 1))
    fitOpenings(floor, 'w1')
    expect(floor.openings.map((o) => o.offsetM)).toEqual([1, 2])
    expect(valid(floor)).toEqual([])
  })

  it('shrinks openings that no longer fit, keeping them all', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(1, 0), 'brick')
    floor.openings.push(opening('a', 'w1', 0, 1), opening('b', 'w1', 1, 1))
    fitOpenings(floor, 'w1')
    expect(floor.openings.map((o) => [o.offsetM, o.widthM])).toEqual([
      [0, 0.5],
      [0.5, 0.5],
    ])
    expect(valid(floor)).toEqual([])
  })
})

describe('moving corners', () => {
  it('stretches every wall attached to a moved corner', () => {
    const floor = corner()
    moveNodes(floor, [nodeAtPoint(floor, 4, 0)], p(1, 1))
    expect(describeWalls(floor)).toEqual(['0,0-5,1 brick', '4,3-5,1 drywall'])
  })

  it('joins a dropped corner onto another corner', () => {
    const floor = corner()
    addWall(floor, p(6, 0), p(6, 3), 'glass')
    const moved = nodeAtPoint(floor, 6, 0)
    moveNodes(floor, [moved], p(-2, 0))
    const joined = joinNode(floor, moved)
    expect(joined).toBe(nodeAtPoint(floor, 4, 0))
    expect(floor.nodes).toHaveLength(4)
    expect(valid(floor)).toEqual([])
  })

  it('splits a wall where a corner is dropped on it', () => {
    const floor = corner()
    addWall(floor, p(2, 2), p(2, 5), 'wood')
    const moved = nodeAtPoint(floor, 2, 2)
    moveNodes(floor, [moved], p(0, -2))
    joinNode(floor, moved)
    expect(describeWalls(floor)).toEqual([
      '0,0-2,0 brick',
      '2,0-2,5 wood',
      '2,0-4,0 brick',
      '4,0-4,3 drywall',
    ])
  })

  it('removes a wall collapsed by joining its own two corners', () => {
    const floor = corner()
    const moved = nodeAtPoint(floor, 4, 3)
    moveNodes(floor, [moved], p(0, -3))
    joinNode(floor, moved)
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick'])
  })

  it('merges walls that become duplicates, keeping their openings', () => {
    // Two walls from (0,0): to (4,0) and to (4,1); dropping (4,1) on (4,0).
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    addWall(floor, p(0, 0), p(4, 1), 'glass')
    floor.openings.push(opening('d', 'w2', 1, 0.8))
    const moved = nodeAtPoint(floor, 4, 1)
    moveNodes(floor, [moved], p(0, -1))
    joinNode(floor, moved)
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick'])
    expect(floor.openings[0]).toMatchObject({ wallId: 'w1' })
    expect(floor.openings[0]!.offsetM).toBeCloseTo(1, 1)
    expect(valid(floor)).toEqual([])
  })

  it('collapses walls shorter than 1 cm', () => {
    const floor = corner()
    moveNodes(floor, [nodeAtPoint(floor, 4, 3)], p(0, -2.995))
    collapseShortWalls(floor)
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick'])
  })
})

describe('deleteWall', () => {
  it('removes the wall, its openings and unused corners', () => {
    const floor = corner()
    floor.openings.push(opening('d', 'w2', 1, 0.8))
    deleteWall(floor, 'w2')
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick'])
    expect(floor.openings).toEqual([])
    expect(floor.nodes).toHaveLength(2)
  })

  it('merges the straight halves left behind by removing a T stem', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(4, 0), 'brick')
    floor.openings.push(opening('win', 'w1', 3, 0.5))
    addWall(floor, p(2, 0), p(2, 3), 'drywall') // splits w1 at (2, 0)
    const stem = floor.walls.find((w) => w.material === 'drywall')!
    deleteWall(floor, stem.id)
    expect(describeWalls(floor)).toEqual(['0,0-4,0 brick'])
    expect(floor.nodes).toHaveLength(2)
    expect(floor.openings[0]!.offsetM).toBeCloseTo(3, 9)
    expect(valid(floor)).toEqual([])
  })

  it('does not merge halves of different materials', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(2, 0), 'brick')
    addWall(floor, p(2, 0), p(4, 0), 'glass')
    addWall(floor, p(2, 0), p(2, 3), 'drywall')
    deleteWall(floor, floor.walls.find((w) => w.material === 'drywall')!.id)
    expect(floor.walls).toHaveLength(2)
  })
})

describe('deleteNode', () => {
  it('merges the two walls at a corner, taking the longer one’s material', () => {
    const floor = corner()
    deleteNode(floor, nodeAtPoint(floor, 4, 0))
    expect(describeWalls(floor)).toEqual(['0,0-4,3 brick'])
    expect(valid(floor)).toEqual([])
  })

  it('keeps openings on a merged straight wall, in place', () => {
    const floor = emptyFloor()
    addWall(floor, p(0, 0), p(2, 0), 'brick')
    addWall(floor, p(2, 0), p(5, 0), 'brick')
    floor.openings.push(opening('d', 'w2', 1, 1)) // from 3 to 4 on the plan
    deleteNode(floor, nodeAtPoint(floor, 2, 0))
    expect(floor.openings[0]).toMatchObject({ wallId: 'w1' })
    expect(floor.openings[0]!.offsetM).toBeCloseTo(3, 9)
  })

  it('removes a corner with three walls along with those walls', () => {
    const floor = corner()
    addWall(floor, p(4, 0), p(7, 0), 'glass')
    deleteNode(floor, nodeAtPoint(floor, 4, 0))
    expect(floor.walls).toEqual([])
    expect(floor.nodes).toEqual([])
  })
})

describe('setWallLength', () => {
  it('moves the end corner along the wall, stretching attached walls', () => {
    const floor = corner()
    setWallLength(floor, 'w1', 5)
    expect(describeWalls(floor)).toEqual(['0,0-5,0 brick', '4,3-5,0 drywall'])
  })

  it('refits openings on the shortened wall', () => {
    const floor = corner()
    floor.openings.push(opening('d', 'w1', 3, 0.9))
    setWallLength(floor, 'w1', 3)
    expect(floor.openings[0]!.offsetM).toBeCloseTo(2.1, 9)
    expect(valid(floor)).toEqual([])
  })

  it('ignores lengths under 1 cm', () => {
    const floor = corner()
    setWallLength(floor, 'w1', 0.001)
    expect(describeWalls(floor)).toContain('0,0-4,0 brick')
  })
})
