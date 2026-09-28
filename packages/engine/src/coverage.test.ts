import {
  materialSegments,
  parsePlan,
  type AccessPoint,
  type Floor,
  type MaterialSegment,
  type Plan,
  type WallMaterial,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES } from './bands.ts'
import {
  cellCentre,
  evaluateCoverage,
  gridForFloor,
  predictDbm,
  RECEIVER_HEIGHT_M,
} from './coverage.ts'
import { MATERIAL_LOSS_DB } from './materials.ts'
import { handleRequest, transferables } from './worker.ts'

const FIVE = BAND_PROFILES['5GHz']

function ap(overrides: Partial<AccessPoint> = {}): AccessPoint {
  return {
    id: 'ap',
    name: 'AP',
    floorId: 'f',
    x: 0,
    y: 0,
    heightM: RECEIVER_HEIGHT_M,
    radios: [{ band: '5GHz' }],
    ...overrides,
  }
}

function floor(
  walls: [number, number, number, number, WallMaterial][] = [],
): Floor {
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

describe('predictDbm', () => {
  const radio = { band: '5GHz' } as const

  it('follows free-space loss with distance', () => {
    const at10 = predictDbm([], ap(), radio, { x: 10, y: 0 })
    expect(at10).toBeCloseTo(
      FIVE.defaultTxPowerDbm - FIVE.referenceLossDb - 20,
      9,
    )
    const at20 = predictDbm([], ap(), radio, { x: 20, y: 0 })
    expect(at10 - at20).toBeCloseTo(20 * Math.log10(2), 9)
  })

  it('uses the radio EIRP when set', () => {
    const point = { x: 5, y: 0 }
    const base = predictDbm([], ap(), radio, point)
    expect(
      predictDbm([], ap(), { band: '5GHz', txPowerDbm: 13 }, point),
    ).toBeCloseTo(base - (FIVE.defaultTxPowerDbm - 13), 9)
  })

  it('treats anything within 1 m as 1 m', () => {
    const expected = FIVE.defaultTxPowerDbm - FIVE.referenceLossDb
    expect(predictDbm([], ap(), radio, { x: 0, y: 0 })).toBeCloseTo(expected, 9)
    expect(predictDbm([], ap(), radio, { x: 0.5, y: 0 })).toBeCloseTo(
      expected,
      9,
    )
  })

  it('measures distance in 3D from the mounting height', () => {
    const high = ap({ heightM: RECEIVER_HEIGHT_M + 3 })
    const below = predictDbm([], high, radio, { x: 4, y: 0 })
    expect(below).toBeCloseTo(predictDbm([], ap(), radio, { x: 5, y: 0 }), 9)
  })

  it('subtracts the loss of each wall crossed', () => {
    const segments = materialSegments(floor([[3, -1, 3, 1, 'brick']]))
    const open = predictDbm([], ap(), radio, { x: 6, y: 0 })
    const walled = predictDbm(segments, ap(), radio, { x: 6, y: 0 })
    expect(open - walled).toBeCloseTo(MATERIAL_LOSS_DB['5GHz'].brick, 9)
  })

  it('never gets stronger when a wall is added', () => {
    // Deterministic pseudo-random walls and points (mulberry32).
    let seed = 42
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const materials: WallMaterial[] = ['drywall', 'brick', 'glass', 'metal']
    for (let trial = 0; trial < 200; trial++) {
      const walls: [number, number, number, number, WallMaterial][] = []
      for (let i = 0; i < 5; i++) {
        walls.push([
          random() * 10,
          random() * 10,
          random() * 10,
          random() * 10,
          materials[Math.floor(random() * materials.length)]!,
        ])
      }
      const point = { x: random() * 10, y: random() * 10 }
      const source = ap({ x: random() * 10, y: random() * 10 })
      const before = materialSegments(floor(walls.slice(0, 4)))
      const after: MaterialSegment[] = materialSegments(floor(walls))
      expect(predictDbm(after, source, radio, point)).toBeLessThanOrEqual(
        predictDbm(before, source, radio, point) + 1e-9,
      )
    }
  })
})

describe('gridForFloor', () => {
  it('covers the walls plus a 1 m margin, snapped to whole cells', () => {
    const grid = gridForFloor(floor([[0, 0, 4, 3, 'brick']]), 0.5)
    expect(grid).toEqual({
      originX: -1,
      originY: -1,
      cellM: 0.5,
      cols: 12,
      rows: 10,
    })
    expect(cellCentre(grid, 0, 0)).toEqual({ x: -0.75, y: -0.75 })
  })

  it('is empty for a floor with no walls or access points', () => {
    expect(gridForFloor(floor()).cols).toBe(0)
  })

  it('covers access points outside the walls', () => {
    const grid = gridForFloor(floor([[0, 0, 4, 3, 'brick']]), 0.5, [
      { x: 6, y: 1 },
    ])
    expect(grid.originX + grid.cols * grid.cellM).toBe(7)
  })

  it('reaches 5 m around access points on a floor with no walls', () => {
    const grid = gridForFloor(floor(), 1, [{ x: 5, y: 4 }])
    expect(grid).toEqual({
      originX: 0,
      originY: -1,
      cellM: 1,
      cols: 10,
      rows: 10,
    })
  })
})

describe('evaluateCoverage', () => {
  it('takes the strongest access point in each cell', () => {
    const left = ap({ id: 'left', x: 0, y: 0 })
    const right = ap({ id: 'right', x: 10, y: 0 })
    const f = floor([[0, -1, 10, 1, 'drywall']])
    const coverage = evaluateCoverage(plan(f, [left, right]), 'f', '5GHz', 0.5)
    const { grid } = coverage
    const at = (x: number) => {
      const col = Math.floor((x - grid.originX) / grid.cellM)
      const row = Math.floor((0 - grid.originY) / grid.cellM)
      return coverage.strongest[row * grid.cols + col]
    }
    expect(coverage.accessPointIds).toEqual(['left', 'right'])
    expect(at(1)).toBe(0)
    expect(at(9)).toBe(1)
  })

  it('ignores access points without a radio in the band, or on other floors', () => {
    const f = floor([[0, 0, 4, 4, 'brick']])
    const coverage = evaluateCoverage(
      plan(f, [
        ap({ id: 'twoFour', radios: [{ band: '2.4GHz' }] }),
        ap({ id: 'upstairs', floorId: 'attic' }),
      ]),
      'f',
      '5GHz',
    )
    expect(coverage.accessPointIds).toEqual([])
    expect(coverage.dbm.every((v) => v === Number.NEGATIVE_INFINITY)).toBe(true)
    expect(coverage.strongest.every((v) => v === -1)).toBe(true)
  })

  it('rejects an unknown floor', () => {
    expect(() => evaluateCoverage(plan(floor(), []), 'nope', '5GHz')).toThrow(
      /No floor/,
    )
  })

  // Speed against the 200 ms budget is checked in coverage.speed.ts.
})

describe('worker protocol', () => {
  it('answers a coverage request with transferable grids', () => {
    const result = parsePlan(sampleHome)
    if (!result.ok) throw new Error('fixture is invalid')
    const response = handleRequest({
      id: 7,
      kind: 'coverage',
      plan: result.plan,
      floorId: 'main',
      band: '2.4GHz',
      cellM: 0.5,
    })
    expect(response.id).toBe(7)
    expect(response.kind).toBe('coverage')
    expect(transferables(response)).toHaveLength(3)
  })

  it('turns failures into error responses', () => {
    const result = parsePlan(sampleHome)
    if (!result.ok) throw new Error('fixture is invalid')
    const response = handleRequest({
      id: 8,
      kind: 'coverage',
      plan: result.plan,
      floorId: 'missing',
      band: '5GHz',
    })
    expect(response).toEqual({
      id: 8,
      kind: 'error',
      message: 'No floor with id "missing".',
    })
    expect(transferables(response)).toEqual([])
  })
})
