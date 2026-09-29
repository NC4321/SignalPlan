import {
  parsePlan,
  type AccessPoint,
  type Floor,
  type Opening,
  type Plan,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import {
  evaluateCoverage,
  gridForFloor,
  predictDbm,
  RECEIVER_HEIGHT_M,
  type Coverage,
} from './coverage.ts'
import { floorAreaMask, segmentsTouch, summariseCoverage } from './floorArea.ts'

/** A floor whose walls join the given corners in order; closed when asked. */
function outline(
  corners: [number, number][],
  { closed = true, openings = [] as Opening[] } = {},
): Floor {
  const count = closed ? corners.length : corners.length - 1
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: corners.map(([x, y], i) => ({ id: `n${i}`, x, y })),
    walls: Array.from({ length: count }, (_, i) => ({
      id: `w${i}`,
      from: `n${i}`,
      to: `n${(i + 1) % corners.length}`,
      material: 'drywall' as const,
    })),
    openings,
  }
}

/** Floor area inside the walls, in m², at 10 cm cells. */
function areaOf(floor: Floor): number {
  const grid = gridForFloor(floor)
  const inside = floorAreaMask(floor, grid).reduce((sum, v) => sum + v, 0)
  return inside * grid.cellM * grid.cellM
}

const SQUARE: [number, number][] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
]

describe('segmentsTouch', () => {
  const p = (x: number, y: number) => ({ x, y })

  it('finds crossings and touching endpoints', () => {
    expect(segmentsTouch(p(0, 0), p(2, 2), p(0, 2), p(2, 0))).toBe(true)
    expect(segmentsTouch(p(0, 0), p(2, 0), p(1, 0), p(1, 1))).toBe(true)
    expect(segmentsTouch(p(0, 0), p(2, 0), p(1, 0.01), p(1, 1))).toBe(false)
  })

  it('treats overlapping collinear segments as touching', () => {
    expect(segmentsTouch(p(0, 0), p(2, 0), p(1, 0), p(3, 0))).toBe(true)
    expect(segmentsTouch(p(0, 0), p(2, 0), p(2.5, 0), p(3, 0))).toBe(false)
  })
})

describe('floorAreaMask', () => {
  it('leaves out openings in the floor, such as a stairwell (D54)', () => {
    // A 1 × 0.5 m stairwell in the 2 × 2 m room, its edges on cell edges.
    const floor: Floor = {
      ...outline(SQUARE),
      floorOpenings: [
        {
          id: 'stairs',
          points: [
            { x: 0.5, y: 0.5 },
            { x: 1.5, y: 0.5 },
            { x: 1.5, y: 1 },
            { x: 0.5, y: 1 },
          ],
        },
      ],
    }
    expect(areaOf(outline(SQUARE))).toBeCloseTo(4, 9)
    expect(areaOf(floor)).toBeCloseTo(3.5, 9)
  })

  it('counts the cells inside a closed 2 × 2 m room', () => {
    // Cell centres sit at 0.05, 0.15 … 1.95 inside the room: 20 × 20 cells.
    expect(areaOf(outline(SQUARE))).toBeCloseTo(4, 9)
  })

  it('has no area while the outline is open', () => {
    expect(areaOf(outline(SQUARE, { closed: false }))).toBe(0)
  })

  it('counts door and window gaps as closed', () => {
    const door: Opening = {
      id: 'o',
      wallId: 'w0',
      kind: 'door',
      offsetM: 0.5,
      widthM: 0.9,
      material: 'open',
    }
    expect(areaOf(outline(SQUARE, { openings: [door] }))).toBeCloseTo(4, 9)
  })

  it('adds up rooms that share a wall', () => {
    const floor = outline([
      [0, 0],
      [2, 0],
      [4, 0],
      [4, 2],
      [2, 2],
      [0, 2],
    ])
    floor.walls.push({
      id: 'partition',
      from: 'n1',
      to: 'n4',
      material: 'brick',
    })
    expect(areaOf(floor)).toBeCloseTo(8, 9)
  })

  it('follows a diagonal wall', () => {
    // Right triangle with legs of 2.02 m: centres (i + ½, j + ½)·0.1 with
    // x + y < 2.02 need i + j ≤ 19, which is 1 + 2 + … + 20 = 210 cells.
    const area = areaOf(
      outline([
        [0, 0],
        [2.02, 0],
        [0, 2.02],
      ]),
    )
    expect(area).toBeCloseTo(2.1, 9)
  })

  it('never leaks through walls that run along cell centres', () => {
    // Walls at 0.05 and 2.05 pass through a row of centres on each side.
    // Those centres can't be reached, so they count: 21 × 21 cells.
    const shifted = SQUARE.map(([x, y]): [number, number] => [
      x + 0.05,
      y + 0.05,
    ])
    expect(areaOf(outline(shifted))).toBeCloseTo(4.41, 9)
  })

  it('measures the sample home at its stated 150 m²', () => {
    const result = parsePlan(sampleHome)
    if (!result.ok) throw new Error('fixture is invalid')
    expect(areaOf(result.plan.floors[0]!)).toBeCloseTo(150, 6)
  })

  it('is empty for a floor with no walls', () => {
    const floor = outline([])
    const grid = gridForFloor(floor, 0.1, [{ x: 0, y: 0 }])
    expect(floorAreaMask(floor, grid).every((v) => v === 0)).toBe(true)
  })
})

describe('summariseCoverage', () => {
  function coverage(dbm: number[], floorArea: number[]): Coverage {
    return {
      grid: { originX: 0, originY: 0, cellM: 0.5, cols: dbm.length, rows: 1 },
      band: '5GHz',
      dbm: Float32Array.from(dbm),
      strongest: new Int16Array(dbm.length),
      floorArea: Uint8Array.from(floorArea),
      accessPointIds: [],
      sourceDbm: new Float32Array(0),
    }
  }

  it('counts only cells inside the walls, at or above the target', () => {
    // Inside: −60, −67, −70, −Infinity; the −40 cell outside doesn't count.
    const summary = summariseCoverage(
      coverage([-40, -60, -67, -70, Number.NEGATIVE_INFINITY], [0, 1, 1, 1, 1]),
      -67,
    )
    expect(summary).toEqual({ areaM2: 1, coveredM2: 0.5, share: 0.5 })
  })

  it('has no share without floor area', () => {
    const summary = summariseCoverage(coverage([-40], [0]), -67)
    expect(summary).toEqual({ areaM2: 0, coveredM2: 0, share: undefined })
  })

  it('matches the disc of strong signal around one access point', () => {
    // In an empty 30 × 30 m room, the target is the signal 10 m away, so the
    // covered area is a disc of radius 10 m: π·10² / 30² ≈ 0.349.
    const side = 30
    const ap: AccessPoint = {
      id: 'ap',
      name: 'AP',
      floorId: 'f',
      x: side / 2,
      y: side / 2,
      heightM: RECEIVER_HEIGHT_M,
      radios: [{ band: '5GHz' }],
    }
    const plan: Plan = {
      schemaVersion: 1,
      name: 'Hall',
      floors: [
        outline([
          [0, 0],
          [side, 0],
          [side, side],
          [0, side],
        ]),
      ],
      accessPoints: [ap],
    }
    const target = predictDbm([], ap, ap.radios[0]!, { x: ap.x + 10, y: ap.y })
    const summary = summariseCoverage(
      evaluateCoverage(plan, 'f', '5GHz'),
      target,
    )
    expect(summary.areaM2).toBeCloseTo(side * side, 6)
    expect(summary.share).toBeCloseTo((Math.PI * 100) / (side * side), 2)
  })
})
