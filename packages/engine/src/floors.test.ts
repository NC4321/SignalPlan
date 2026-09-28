import {
  type AccessPoint,
  type Band,
  type Floor,
  type FloorMaterial,
  type Plan,
  type WallMaterial,
} from '@signalplan/floorplan'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES } from './bands.ts'
import { cellCentre, evaluateCoverage, gridForFloor } from './coverage.ts'
import { crossingLossDb, floorCrossing, prepareStack } from './floors.ts'
import { FLOOR_LOSS_DB, MATERIAL_LOSS_DB } from './materials.ts'

const FIVE = BAND_PROFILES['5GHz']
const TIMBER = FLOOR_LOSS_DB['5GHz']['timber-joist']
const SLAB = FLOOR_LOSS_DB['5GHz']['concrete-slab']
const BRICK = MATERIAL_LOSS_DB['5GHz'].brick
const DRYWALL = MATERIAL_LOSS_DB['5GHz'].drywall

type WallSpec = [number, number, number, number, WallMaterial]

function storey(
  id: string,
  elevationM: number,
  walls: readonly WallSpec[] = [],
  material?: FloorMaterial,
  heightM = 2.4,
): Floor {
  return {
    id,
    name: id,
    elevationM,
    heightM,
    ...(material ? { material } : {}),
    nodes: walls.flatMap(([x1, y1, x2, y2], i) => [
      { id: `a${i}`, x: x1, y: y1 },
      { id: `b${i}`, x: x2, y: y2 },
    ]),
    walls: walls.map(([, , , , m], i) => ({
      id: `w${i}`,
      from: `a${i}`,
      to: `b${i}`,
      material: m,
    })),
    openings: [],
  }
}

function ap(
  floorId: string,
  x: number,
  y: number,
  heightM: number,
  band: Band = '5GHz',
): AccessPoint {
  return {
    id: `ap-${floorId}-${x}-${y}`,
    name: 'AP',
    floorId,
    x,
    y,
    heightM,
    radios: [{ band }],
  }
}

function plan(floors: Floor[], accessPoints: AccessPoint[]): Plan {
  return { schemaVersion: 1, name: 'Test', floors, accessPoints }
}

/** Free-space signal on 5 GHz at the default power, at distance d ≥ 1 m. */
const freeSpace = (d: number) =>
  FIVE.defaultTxPowerDbm -
  FIVE.referenceLossDb -
  10 * FIVE.pathLossExponent * Math.log10(d)

/** The signal in the cell whose centre is (x, y). */
function dbmAt(p: Plan, floorId: string, x: number, y: number, cellM = 0.1) {
  const coverage = evaluateCoverage(p, floorId, '5GHz', cellM)
  const { grid } = coverage
  const col = Math.floor((x - grid.originX) / grid.cellM)
  const row = Math.floor((y - grid.originY) / grid.cellM)
  const centre = cellCentre(grid, col, row)
  expect(centre.x).toBeCloseTo(x, 9)
  expect(centre.y).toBeCloseTo(y, 9)
  return coverage.dbm[row * grid.cols + col]!
}

// A two-storey house: ground floor at 0 m and the upstairs at 2.7 m, each
// 2.4 m floor to ceiling, so a 0.3 m slab between. The router is on the
// ground floor at (0.05, 0.05), 2 m up: z = 2 m. A receiver upstairs is at
// z = 2.7 + 1 = 3.7 m, 1.7 m higher.
const RISE = 1.7

describe('floorCrossing (hand-worked)', () => {
  const stack = prepareStack(
    plan([storey('ground', 0), storey('up', 2.7)], []),
    '5GHz',
  )

  it('splits the path at the ceiling below and the surface above', () => {
    const crossing = floorCrossing(stack, 0, 2, 1, 3.7)
    // Leaves the ground floor at its ceiling, 2.4 m: t = 0.4 / 1.7.
    // Enters the upstairs at its surface, 2.7 m: t = 0.7 / 1.7.
    const [lower, upper] = crossing.stretches
    expect(lower!.fromT).toBe(0)
    expect(lower!.toT).toBeCloseTo(0.4 / 1.7, 12)
    expect(upper!.fromT).toBeCloseTo(0.7 / 1.7, 12)
    expect(upper!.toT).toBe(1)
    expect(crossing.slabLossDb).toBe(TIMBER)
  })

  it('splits a downward path the same way, from the other end', () => {
    // Upstairs router 2 m up (z = 4.7), receiver downstairs at z = 1.
    const crossing = floorCrossing(stack, 1, 4.7, 0, 1)
    // Leaves at the upstairs surface, 2.7 m: t = 2 / 3.7.
    // Enters the ground floor at its ceiling, 2.4 m: t = 2.3 / 3.7.
    const [upper, lower] = crossing.stretches
    expect(upper!.fromT).toBe(0)
    expect(upper!.toT).toBeCloseTo(2 / 3.7, 12)
    expect(lower!.fromT).toBeCloseTo(2.3 / 3.7, 12)
    expect(lower!.toT).toBe(1)
    expect(crossing.slabLossDb).toBe(TIMBER)
  })

  it('splits halfway when the path does not rise towards the upper floor', () => {
    // Mounted 5 m up, above the upstairs receiver at 3.7 m.
    const crossing = floorCrossing(stack, 0, 5, 1, 3.7)
    expect(crossing.stretches.map((s) => [s.fromT, s.toT])).toEqual([
      [0, 0.5],
      [0.5, 1],
    ])
  })
})

describe('signal from another floor (hand-worked)', () => {
  it('pays the 3D distance and one slab', () => {
    // Upstairs cell (3.05, 0.05): 3 m across and 1.7 m up from the router.
    const p = plan(
      [storey('ground', 0), storey('up', 2.7)],
      [ap('ground', 0.05, 0.05, 2)],
    )
    expect(dbmAt(p, 'up', 3.05, 0.05)).toBeCloseTo(
      freeSpace(Math.sqrt(3 ** 2 + RISE ** 2)) - TIMBER,
      4,
    )
  })

  it('pays only the slab straight above the router', () => {
    // 1.7 m straight up: the distance is 1.7 m and no wall is on the way.
    const p = plan(
      [
        storey('ground', 0, [[-1, -1, 1, 1, 'brick']]),
        storey('up', 2.7, [[-1, 1, 1, -1, 'brick']]),
      ],
      [ap('ground', 0.05, 0.05, 2)],
    )
    expect(dbmAt(p, 'up', 0.05, 0.05)).toBeCloseTo(freeSpace(RISE) - TIMBER, 4)
  })

  it("counts each floor's walls only along its own stretch", () => {
    // The path from (0.05, 0.05) to (3.05, 0.05) is in the ground floor up
    // to x = 0.05 + 3 · 0.4/1.7 ≈ 0.756, in the slab to x ≈ 1.285, then
    // upstairs. Walls on the ground floor at x = 0.5 (crossed) and x = 1
    // (above the ceiling: not crossed); upstairs at x = 1 (below its
    // surface: not crossed) and x = 2.5 (crossed).
    const p = plan(
      [
        storey('ground', 0, [
          [0.5, -5, 0.5, 5, 'brick'],
          [1, -5, 1, 5, 'brick'],
        ]),
        storey('up', 2.7, [
          [1, -5, 1, 5, 'drywall'],
          [2.5, -5, 2.5, 5, 'drywall'],
        ]),
      ],
      [ap('ground', 0.05, 0.05, 2)],
    )
    expect(dbmAt(p, 'up', 3.05, 0.05)).toBeCloseTo(
      freeSpace(Math.sqrt(3 ** 2 + RISE ** 2)) - BRICK - TIMBER - DRYWALL,
      4,
    )
  })

  it('crosses the slab of each floor above the lower end, not the lowest', () => {
    // Basement at −2.7 m, ground floor a concrete slab at 0, upstairs timber
    // at 2.7. The basement's own floor is never crossed.
    const floors = [
      storey('basement', -2.7, [], 'concrete-slab'),
      storey('ground', 0, [], 'concrete-slab'),
      storey('up', 2.7),
    ]
    // Basement router 2 m up (z = −0.7) to a cell upstairs (z = 3.7).
    const up = plan(floors, [ap('basement', 0.05, 0.05, 2)])
    expect(dbmAt(up, 'up', 3.05, 0.05)).toBeCloseTo(
      freeSpace(Math.sqrt(3 ** 2 + 4.4 ** 2)) - SLAB - TIMBER,
      4,
    )
    // And back down: upstairs router 2 m up (z = 4.7) to the basement (z = −1.7).
    const down = plan(floors, [ap('up', 0.05, 0.05, 2)])
    expect(dbmAt(down, 'basement', 3.05, 0.05)).toBeCloseTo(
      freeSpace(Math.sqrt(3 ** 2 + 6.4 ** 2)) - SLAB - TIMBER,
      4,
    )
  })

  it('stacks floors by elevation, whatever order the plan lists them in', () => {
    const aps = [ap('ground', 0.05, 0.05, 2)]
    const inOrder = plan([storey('ground', 0), storey('up', 2.7)], aps)
    const reversed = plan([storey('up', 2.7), storey('ground', 0)], aps)
    expect(dbmAt(reversed, 'up', 3.05, 0.05)).toBe(
      dbmAt(inOrder, 'up', 3.05, 0.05),
    )
  })

  it('takes the strongest access point from any floor, and names it', () => {
    // Upstairs AP at (5.05, 0.05), 1 m up, so level with the receiver.
    const upstairs = { ...ap('up', 5.05, 0.05, 1), id: 'upstairs' }
    const router = { ...ap('ground', 0.05, 0.05, 2), id: 'router' }
    const p = plan(
      [storey('ground', 0, [[-10, -10, 10, -10, 'brick']]), storey('up', 2.7)],
      [router, upstairs],
    )
    const coverage = evaluateCoverage(p, 'up', '5GHz')
    expect(coverage.accessPointIds).toEqual(['router', 'upstairs'])
    const index = (x: number, y: number) => {
      const { grid } = coverage
      const col = Math.floor((x - grid.originX) / grid.cellM)
      const row = Math.floor((y - grid.originY) / grid.cellM)
      return row * grid.cols + col
    }
    // Straight above the router: 1.7 m against 5 m in the open.
    expect(coverage.strongest[index(0.05, 0.05)]).toBe(0)
    expect(coverage.strongest[index(5.05, 0.05)]).toBe(1)
  })
})

describe('the grid of a floor with no walls yet', () => {
  it('reaches 5 m around access points on other floors too', () => {
    const p = plan(
      [storey('ground', 0, [[0, 0, 10, 0, 'brick']]), storey('up', 2.7)],
      [ap('ground', 3, 0, 2)],
    )
    const coverage = evaluateCoverage(p, 'up', '5GHz')
    expect(coverage.grid).toEqual(
      gridForFloor(p.floors[1]!, 0.1, [{ x: 3, y: 0 }]),
    )
    expect(coverage.grid.cols).toBe(100)
  })

  it('follows its own walls once it has some', () => {
    const up = storey('up', 2.7, [[0, 0, 4, 0, 'drywall']])
    const p = plan(
      [storey('ground', 0, [[0, 0, 10, 0, 'brick']]), up],
      [ap('ground', 9, 0, 2)],
    )
    expect(evaluateCoverage(p, 'up', '5GHz').grid).toEqual(
      gridForFloor(up, 0.1),
    )
  })
})

// Property tests, as in properties.test.ts.
const RUNS = { seed: 87, numRuns: 100 }
const EPSILON_DB = 1e-9
const coordinate = fc.double({ min: -8, max: 8, noNaN: true })
const floorMaterial = fc.constantFrom<FloorMaterial>(
  'timber-joist',
  'concrete-slab',
)
const wallSpec: fc.Arbitrary<WallSpec> = fc
  .tuple(
    coordinate,
    coordinate,
    coordinate,
    coordinate,
    fc.constantFrom<WallMaterial>('drywall', 'brick', 'concrete', 'wood'),
  )
  .filter(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1) >= 0.01)
/** A storey's height and the slab above it, as (floor to ceiling, gap). */
const storeyShape = fc.tuple(
  fc.double({ min: 2, max: 3.5, noNaN: true }),
  fc.double({ min: 0, max: 0.6, noNaN: true }),
  floorMaterial,
)

/** Floors stacked from 0 m, each on top of the last, with no walls. */
function openStack(shapes: readonly [number, number, FloorMaterial][]) {
  let elevation = 0
  return shapes.map(([height, gap, material], i) => {
    const f = storey(`f${i}`, elevation, [], material, height)
    elevation += height + gap
    return f
  })
}

describe('crossing floors (properties)', () => {
  it('more floors between never raise the signal, with no walls', () => {
    fc.assert(
      fc.property(
        fc.array(storeyShape, { minLength: 2, maxLength: 5 }),
        storeyShape,
        fc.nat(),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.array(fc.record({ x: coordinate, y: coordinate }), {
          minLength: 1,
          maxLength: 10,
        }),
        (shapes, extra, at, apHeight, points) => {
          // Insert one more storey just above the router's floor (0).
          const where = 1 + (at % (shapes.length - 1))
          const before = openStack(shapes)
          const after = openStack([
            ...shapes.slice(0, where),
            extra,
            ...shapes.slice(where),
          ])
          const top = before.length - 1
          const signal = (floors: Floor[], x: number, y: number) => {
            const stack = prepareStack(plan(floors, []), '5GHz')
            const last = stack.length - 1
            const apZ = apHeight
            const z = floors[last]!.elevationM + 1
            const crossing = floorCrossing(stack, 0, apZ, last, z)
            const loss = crossingLossDb(crossing, 0, 0, x, y)
            return freeSpace(Math.max(Math.hypot(x, y, z - apZ), 1)) - loss
          }
          expect(after.length).toBe(top + 2)
          for (const { x, y } of points) {
            expect(signal(after, x, y)).toBeLessThanOrEqual(
              signal(before, x, y) + EPSILON_DB,
            )
          }
        },
      ),
      RUNS,
    )
  })

  it('lose the same both ways along a path (reciprocity)', () => {
    fc.assert(
      fc.property(
        fc.array(storeyShape, { minLength: 2, maxLength: 4 }),
        fc.array(fc.array(wallSpec, { maxLength: 4 }), {
          minLength: 4,
          maxLength: 4,
        }),
        fc.nat(),
        fc.nat(),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.record({ x: coordinate, y: coordinate }),
        fc.record({ x: coordinate, y: coordinate }),
        (shapes, walls, i, j, ha, hb, a, b) => {
          const floors = openStack(shapes).map((f, k) => ({
            ...storey(f.id, f.elevationM, walls[k]!, f.material, f.heightM),
          }))
          const stack = prepareStack(plan(floors, []), '5GHz')
          const from = i % stack.length
          const to = j % stack.length
          if (from === to) return
          const za = floors[from]!.elevationM + ha
          const zb = floors[to]!.elevationM + hb
          const there = crossingLossDb(
            floorCrossing(stack, from, za, to, zb),
            a.x,
            a.y,
            b.x,
            b.y,
          )
          const back = crossingLossDb(
            floorCrossing(stack, to, zb, from, za),
            b.x,
            b.y,
            a.x,
            a.y,
          )
          // Split points are found from each end, so a wall exactly at a
          // split could land on either side; random walls almost never do.
          expect(back).toBeCloseTo(there, 6)
        },
      ),
      RUNS,
    )
  })

  it('a wall on any floor never raises the signal on another', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(wallSpec, { maxLength: 3 }), {
          minLength: 2,
          maxLength: 2,
        }),
        wallSpec,
        fc.boolean(),
        fc.double({ min: 0, max: 2.4, noNaN: true }),
        fc.record({ x: coordinate, y: coordinate }),
        (walls, extra, onGround, apHeight, target) => {
          const build = (withExtra: boolean) => {
            const ground = walls[0]!.concat(
              withExtra && onGround ? [extra] : [],
            )
            const up = walls[1]!.concat(withExtra && !onGround ? [extra] : [])
            return plan(
              [storey('ground', 0, ground), storey('up', 2.7, up)],
              [{ ...ap('ground', 0, 0, apHeight), x: target.x, y: target.y }],
            )
          }
          const before = cellsOf(build(false))
          const after = cellsOf(build(true))
          for (const [key, value] of before) {
            const next = after.get(key)
            if (next === undefined) continue
            expect(next).toBeLessThanOrEqual(value + EPSILON_DB)
          }
        },
      ),
      { ...RUNS, numRuns: 40 },
    )
  })
})

describe('openings in the floor (properties)', () => {
  /**
   * A rectangle as a floor opening. Its edges sit 0.37 m off whole metres,
   * away from where fast-check shrinks paths to: a point exactly on an edge
   * may fall either way, as a wall exactly at a split may (see above).
   */
  const edge = fc.integer({ min: -8, max: 7 }).map((n) => n + 0.37)
  const hole = fc
    .tuple(edge, edge, edge, edge)
    .filter(([x1, y1, x2, y2]) => x1 !== x2 && y1 !== y2)
    .map(([x1, y1, x2, y2]) => ({
      id: 'hole',
      points: [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 },
      ],
    }))

  it('an opening never lowers the signal', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(wallSpec, { maxLength: 3 }), {
          minLength: 2,
          maxLength: 2,
        }),
        hole,
        fc.boolean(),
        fc.double({ min: 0, max: 2.4, noNaN: true }),
        fc.record({ x: coordinate, y: coordinate }),
        (walls, opening, fromBelow, apHeight, at) => {
          const build = (withHole: boolean) =>
            plan(
              [
                storey('ground', 0, walls[0]!),
                {
                  ...storey('up', 2.7, walls[1]!),
                  ...(withHole ? { floorOpenings: [opening] } : {}),
                },
              ],
              [
                {
                  ...ap(fromBelow ? 'ground' : 'up', 0, 0, apHeight),
                  x: at.x,
                  y: at.y,
                },
              ],
            )
          const floorId = fromBelow ? 'up' : 'ground'
          const before = evaluateCoverage(build(false), floorId, '5GHz', 0.5)
          const after = evaluateCoverage(build(true), floorId, '5GHz', 0.5)
          expect(after.grid).toEqual(before.grid)
          after.dbm.forEach((value, i) => {
            expect(value).toBeGreaterThanOrEqual(before.dbm[i]! - EPSILON_DB)
          })
        },
      ),
      { ...RUNS, numRuns: 40 },
    )
  })

  it('lose the same both ways along a path through openings', () => {
    fc.assert(
      fc.property(
        fc.array(storeyShape, { minLength: 2, maxLength: 4 }),
        fc.array(fc.option(hole), { minLength: 4, maxLength: 4 }),
        fc.nat(),
        fc.nat(),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.record({ x: coordinate, y: coordinate }),
        fc.record({ x: coordinate, y: coordinate }),
        (shapes, holes, i, j, ha, hb, a, b) => {
          const floors = openStack(shapes).map((f, k) =>
            holes[k] ? { ...f, floorOpenings: [holes[k]] } : f,
          )
          const stack = prepareStack(plan(floors, []), '5GHz')
          const from = i % stack.length
          const to = j % stack.length
          if (from === to) return
          const za = floors[from]!.elevationM + ha
          const zb = floors[to]!.elevationM + hb
          const there = crossingLossDb(
            floorCrossing(stack, from, za, to, zb),
            a.x,
            a.y,
            b.x,
            b.y,
          )
          const back = crossingLossDb(
            floorCrossing(stack, to, zb, from, za),
            b.x,
            b.y,
            a.x,
            a.y,
          )
          expect(back).toBeCloseTo(there, 6)
        },
      ),
      RUNS,
    )
  })
})

/** Upstairs signal per cell centre at 0.5 m cells, keyed by position. */
function cellsOf(p: Plan) {
  const { grid, dbm } = evaluateCoverage(p, 'up', '5GHz', 0.5)
  const cells = new Map<string, number>()
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const { x, y } = cellCentre(grid, col, row)
      cells.set(
        `${Math.round(x * 2)},${Math.round(y * 2)}`,
        dbm[row * grid.cols + col]!,
      )
    }
  }
  return cells
}

describe('openings in the floor (D54, hand-worked)', () => {
  /** Upstairs with a rectangular hole in its slab. */
  const holed = (x0: number, y0: number, x1: number, y1: number): Floor => ({
    ...storey('up', 2.7),
    floorOpenings: [
      {
        id: 'stairs',
        points: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      },
    ],
  })

  it('pays no slab straight up through a stairwell', () => {
    const p = plan(
      [storey('ground', 0), holed(-1, -1, 1, 1)],
      [ap('ground', 0.05, 0.05, 2)],
    )
    expect(dbmAt(p, 'up', 0.05, 0.05)).toBeCloseTo(freeSpace(RISE), 4)
  })

  it('pays no slab straight down through it either', () => {
    // Upstairs router 2 m up (z = 4.7) to a ground-floor cell (z = 1).
    const p = plan(
      [storey('ground', 0), holed(-1, -1, 1, 1)],
      [ap('up', 0.05, 0.05, 2)],
    )
    expect(dbmAt(p, 'ground', 0.05, 0.05)).toBeCloseTo(freeSpace(3.7), 4)
  })

  it('counts where the path passes the middle of the slab', () => {
    // From the router at (0.05, 0.05), z = 2, to (3.05, 0.05), z = 3.7. The
    // slab lies between 2.4 and 2.7 m; the path passes its middle, 2.55 m,
    // at t = 0.55 / 1.7, x = 0.05 + 3 · 0.55/1.7 ≈ 1.02.
    const slant = freeSpace(Math.sqrt(3 ** 2 + RISE ** 2))
    const through = plan(
      [storey('ground', 0), holed(0.5, -1, 1.5, 1)],
      [ap('ground', 0.05, 0.05, 2)],
    )
    expect(dbmAt(through, 'up', 3.05, 0.05)).toBeCloseTo(slant, 4)
    // A hole under the receiver doesn't help: the path is already past it.
    const beside = plan(
      [storey('ground', 0), holed(2, -1, 3.5, 1)],
      [ap('ground', 0.05, 0.05, 2)],
    )
    expect(dbmAt(beside, 'up', 3.05, 0.05)).toBeCloseTo(slant - TIMBER, 4)
  })

  it('only spares the slab that has the hole', () => {
    // Three storeys; the hole is in the middle floor's slab only, so a path
    // from the ground floor to the top still pays the top floor's slab.
    const p = plan(
      [
        storey('ground', 0),
        { ...holed(-1, -1, 1, 1), id: 'middle', name: 'middle' },
        storey('top', 5.4),
      ],
      [ap('ground', 0.05, 0.05, 2)],
    )
    expect(dbmAt(p, 'top', 0.05, 0.05)).toBeCloseTo(
      freeSpace(6.4 - 2) - TIMBER,
      4,
    )
  })

  it('changes nothing in the lowest floor, whose slab is never crossed', () => {
    const ground = { ...holed(-1, -1, 1, 1), id: 'ground', elevationM: 0 }
    const p = plan([ground, storey('up', 2.7)], [ap('ground', 0.05, 0.05, 2)])
    expect(dbmAt(p, 'up', 0.05, 0.05)).toBeCloseTo(freeSpace(RISE) - TIMBER, 4)
  })
})
