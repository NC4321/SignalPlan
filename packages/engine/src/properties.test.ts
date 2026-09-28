import {
  materialSegments,
  type AccessPoint,
  type Band,
  type Floor,
  type Plan,
  type WallMaterial,
} from '@signalplan/floorplan'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cellCentre, evaluateCoverage, predictDbm } from './coverage.ts'
import { prepareWalls, preparedWallLoss, wallLoss } from './crossings.ts'
import {
  CONSTRUCTIONS,
  constructionLossDb,
  MATERIAL_LOSS_DB,
} from './materials.ts'
import { P2040_MATERIALS, slabLossDb, type P2040Material } from './slab.ts'

/**
 * Property tests (#37): physical rules that must hold for any plan, checked on
 * random inputs. The seed is fixed so runs are repeatable; fast-check prints
 * the seed and the smallest failing case if a property breaks.
 */
const RUNS = { seed: 37, numRuns: 200 }

/**
 * Floating-point slack in dB. Adding a crossing can change the order in which
 * wall losses are summed, which may move the last bit of the total.
 */
const EPSILON_DB = 1e-9

const BANDS: Band[] = ['2.4GHz', '5GHz', '6GHz']
const MATERIALS = Object.keys(CONSTRUCTIONS) as WallMaterial[]

type WallSpec = [number, number, number, number, WallMaterial]

const coordinate = fc.double({ min: -10, max: 10, noNaN: true })
const band = fc.constantFrom(...BANDS)
const point = fc.record({ x: coordinate, y: coordinate })
const wall: fc.Arbitrary<WallSpec> = fc
  .tuple(
    coordinate,
    coordinate,
    coordinate,
    coordinate,
    fc.constantFrom(...MATERIALS),
  )
  // The schema needs walls at least 1 cm long.
  .filter(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1) >= 0.01)
const accessPoint = (i: number, bandArb = band): fc.Arbitrary<AccessPoint> =>
  fc.record({
    id: fc.constant(`ap${i}`),
    name: fc.constant(`AP ${i}`),
    floorId: fc.constant('f'),
    x: coordinate,
    y: coordinate,
    heightM: fc.double({ min: 0, max: 3, noNaN: true }),
    radios: fc.tuple(
      fc.record(
        {
          band: bandArb,
          txPowerDbm: fc.double({ min: -10, max: 40, noNaN: true }),
        },
        { requiredKeys: ['band'] },
      ),
    ),
  })

function floor(walls: readonly WallSpec[]): Floor {
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: walls.flatMap(([x1, y1, x2, y2], i) => [
      { id: `a${i}`, x: x1, y: y1 },
      { id: `b${i}`, x: x2, y: y2 },
    ]),
    walls: walls.map(([, , , , material], i) => ({
      id: `w${i}`,
      from: `a${i}`,
      to: `b${i}`,
      material,
    })),
    openings: [],
  }
}

function plan(f: Floor, accessPoints: AccessPoint[]): Plan {
  return { schemaVersion: 1, name: 'Test', floors: [f], accessPoints }
}

/**
 * Signal per cell centre, keyed by position, so grids of different extents
 * (adding a wall or an access point can grow the grid) can be compared.
 */
function cellsByPosition(p: Plan, b: Band, cellM: number) {
  const { grid, dbm } = evaluateCoverage(p, 'f', b, cellM)
  const cells = new Map<string, number>()
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const { x, y } = cellCentre(grid, col, row)
      const key = `${Math.round(x / cellM)},${Math.round(y / cellM)}`
      cells.set(key, dbm[row * grid.cols + col]!)
    }
  }
  return cells
}

describe('adding a wall', () => {
  it('never raises the signal at any point', () => {
    fc.assert(
      fc.property(
        fc.array(wall, { maxLength: 8 }),
        wall,
        accessPoint(0),
        fc.array(point, { minLength: 1, maxLength: 20 }),
        (walls, extra, ap, points) => {
          const radio = ap.radios[0]!
          const before = materialSegments(floor(walls))
          const after = materialSegments(floor([...walls, extra]))
          for (const p of points) {
            expect(predictDbm(after, ap, radio, p)).toBeLessThanOrEqual(
              predictDbm(before, ap, radio, p) + EPSILON_DB,
            )
          }
        },
      ),
      RUNS,
    )
  })

  it('never raises the signal in any grid cell', () => {
    fc.assert(
      fc.property(
        fc.array(wall, { maxLength: 4 }),
        wall,
        fc.array(accessPoint(0), { minLength: 1, maxLength: 2 }),
        band,
        (walls, extra, aps, b) => {
          const ids = aps.map((ap, i) => ({ ...ap, id: `ap${i}` }))
          const before = cellsByPosition(plan(floor(walls), ids), b, 0.5)
          const after = cellsByPosition(
            plan(floor([...walls, extra]), ids),
            b,
            0.5,
          )
          for (const [key, value] of before) {
            const next = after.get(key)
            // The first wall can shrink the grid: a floor with no walls
            // reaches 5 m around access points (D20), one with walls 1 m past
            // them. Compare the cells both grids have.
            if (next === undefined) continue
            expect(next).toBeLessThanOrEqual(value + EPSILON_DB)
          }
        },
      ),
      { ...RUNS, numRuns: 50 },
    )
  })
})

describe('distance', () => {
  it('never raises the signal further along a line with no walls', () => {
    fc.assert(
      fc.property(
        accessPoint(0),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 50, noNaN: true }),
        fc.double({ min: 1e-6, max: 50, noNaN: true }),
        (ap, angle, near, step) => {
          const radio = ap.radios[0]!
          const at = (d: number) => ({
            x: ap.x + d * Math.cos(angle),
            y: ap.y + d * Math.sin(angle),
          })
          expect(
            predictDbm([], ap, radio, at(near + step)),
          ).toBeLessThanOrEqual(
            predictDbm([], ap, radio, at(near)) + EPSILON_DB,
          )
        },
      ),
      RUNS,
    )
  })
})

describe('wall losses', () => {
  it('are finite and not negative for every material and band', () => {
    for (const b of BANDS) {
      for (const material of MATERIALS) {
        const loss = MATERIAL_LOSS_DB[b][material]
        expect(Number.isFinite(loss), `${material} at ${b}`).toBe(true)
        expect(loss, `${material} at ${b}`).toBeGreaterThanOrEqual(0)
      }
      expect(MATERIAL_LOSS_DB[b].metal).toBeLessThanOrEqual(40)
    }
  })

  it('are finite and not negative along any path', () => {
    fc.assert(
      fc.property(
        fc.array(wall, { maxLength: 12 }),
        point,
        point,
        band,
        (walls, from, to, b) => {
          const loss = wallLoss(
            materialSegments(floor(walls)),
            from,
            to,
            (material) => MATERIAL_LOSS_DB[b][material],
          )
          expect(Number.isFinite(loss)).toBe(true)
          expect(loss).toBeGreaterThanOrEqual(0)
        },
      ),
      RUNS,
    )
  })

  const dielectric = fc.constantFrom(
    ...(Object.keys(P2040_MATERIALS) as P2040Material[]).filter(
      (m) => m !== 'metal',
    ),
  )
  const layer = fc.record({
    material: dielectric,
    thicknessM: fc.double({ min: 1e-3, max: 0.3, noNaN: true }),
  })

  it('never gain power through any layered wall, at any angle', () => {
    fc.assert(
      fc.property(
        fc.array(layer, { minLength: 1, maxLength: 4 }),
        band,
        fc.double({ min: 0, max: (80 * Math.PI) / 180, noNaN: true }),
        (layers, b, angle) => {
          const frequencies =
            b === '2.4GHz' ? [2.437] : b === '5GHz' ? [5.5] : [6.5]
          const loss = slabLossDb(layers, frequencies, angle)
          expect(Number.isFinite(loss)).toBe(true)
          // A passive wall can't transmit more than arrives.
          expect(loss).toBeGreaterThanOrEqual(-EPSILON_DB)
        },
      ),
      RUNS,
    )
  })

  it('stay capped at 40 dB for metal, however thick', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-4, max: 0.01, noNaN: true }),
        band,
        (thicknessM, b) => {
          const loss = constructionLossDb(
            {
              ...CONSTRUCTIONS.metal,
              layers: [{ material: 'metal', thicknessM }],
            },
            b,
          )
          expect(loss).toBeLessThanOrEqual(40)
          expect(loss).toBeGreaterThan(0)
        },
      ),
      { ...RUNS, numRuns: 50 },
    )
  })
})

describe('adding an access point', () => {
  it('never lowers the signal in any grid cell', () => {
    fc.assert(
      fc.property(
        fc.array(wall, { maxLength: 4 }),
        fc.array(accessPoint(0), { maxLength: 2 }),
        accessPoint(9),
        band,
        (walls, aps, extra, b) => {
          const ids = aps.map((ap, i) => ({ ...ap, id: `ap${i}` }))
          const f = floor(walls)
          const before = cellsByPosition(plan(f, ids), b, 0.5)
          const after = cellsByPosition(plan(f, [...ids, extra]), b, 0.5)
          for (const [key, value] of before) {
            const next = after.get(key)
            expect(next).toBeDefined()
            expect(next!).toBeGreaterThanOrEqual(value)
          }
        },
      ),
      { ...RUNS, numRuns: 50 },
    )
  })
})

describe('the grid fast path (#45)', () => {
  // Whole and half metres as well as any value, so walls share corners, paths
  // touch wall ends and some walls line up with the path.
  const snapped = fc.oneof(
    coordinate,
    fc.integer({ min: -10, max: 10 }),
    fc.integer({ min: -20, max: 20 }).map((n) => n / 2),
  )
  const snappedPoint = fc.record({ x: snapped, y: snapped })
  const snappedWall: fc.Arbitrary<WallSpec> = fc
    .tuple(snapped, snapped, snapped, snapped, fc.constantFrom(...MATERIALS))
    .filter(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1) >= 0.01)

  it('gives exactly the wall loss of the reference', () => {
    fc.assert(
      fc.property(
        fc.array(snappedWall, { maxLength: 12 }),
        snappedPoint,
        snappedPoint,
        band,
        (walls, from, to, b) => {
          const segments = materialSegments(floor(walls))
          const lossOf = (m: WallMaterial) => MATERIAL_LOSS_DB[b][m]
          const prepared = prepareWalls(segments, lossOf)
          expect(preparedWallLoss(prepared, from.x, from.y, to.x, to.y)).toBe(
            wallLoss(segments, from, to, lossOf),
          )
        },
      ),
      { ...RUNS, numRuns: 2000 },
    )
  })

  it('fills every cell exactly as predictDbm would', () => {
    fc.assert(
      fc.property(
        fc.array(snappedWall, { maxLength: 8 }),
        accessPoint(0),
        (walls, ap) => {
          const f = floor(walls)
          const radio = ap.radios[0]!
          const cellM = 0.5
          const { grid, dbm } = evaluateCoverage(
            plan(f, [ap]),
            'f',
            radio.band,
            cellM,
          )
          const segments = materialSegments(f)
          for (let row = 0; row < grid.rows; row++) {
            for (let col = 0; col < grid.cols; col++) {
              const expected = Math.fround(
                predictDbm(segments, ap, radio, cellCentre(grid, col, row)),
              )
              expect(dbm[row * grid.cols + col]).toBe(expected)
            }
          }
        },
      ),
      { ...RUNS, numRuns: 50 },
    )
  })
})
