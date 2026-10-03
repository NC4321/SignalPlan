import {
  parsePlan,
  type AccessPoint,
  type Floor,
  type Opening,
  type Plan,
  type PlanNode,
  type SurveySpot,
  type Wall,
  type WallMaterial,
} from '@signalplan/floorplan'
import apartment from '@signalplan/floorplan/fixtures/apartment.json' with { type: 'json' }
import lShapedHouse from '@signalplan/floorplan/fixtures/l-shaped-house.json' with { type: 'json' }
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import threeApJson from '@signalplan/floorplan/fixtures/three-ap-home.json' with { type: 'json' }
import twoStoreyJson from '@signalplan/floorplan/fixtures/two-storey-home.json' with { type: 'json' }
import { BAND_PROFILES } from './bands.ts'
import type { Calibration } from './calibration.ts'
import { mulberry32 } from './multiSearch.ts'
import { candidatePositions, type Scorer } from './placement.ts'
import { predictReadings } from './survey.ts'

/**
 * Plans for the speed check and the engine's exactness tests.
 */

/**
 * The optimizer's exit gate homes (D47): three shapes and sizes, each with
 * one router where its line comes in.
 */
export function gateHomes(): { name: string; plan: Plan }[] {
  return [
    ['Sample home (150 m², brick bungalow)', sampleHome],
    ['Apartment (65 m², concrete)', apartment],
    ['L-shaped house (220 m², brick and drywall)', lShapedHouse],
  ].map(([name, json]) => {
    const result = parsePlan(json)
    if (!result.ok) throw new Error(`${name} is invalid`)
    return { name: name as string, plan: result.plan }
  })
}

/**
 * The M3 exit gate's two-storey home (D58): the sample bungalow with a
 * 150 m² upper floor of bedrooms over a timber joist floor, and one router
 * downstairs.
 */
export function twoStoreyHome(): Plan {
  const result = parsePlan(twoStoreyJson)
  if (!result.ok) throw new Error('two-storey-home.json is invalid')
  return result.plan
}

/**
 * The Phase 6 exit gate's home (D69): the two-storey home with the router
 * downstairs, a mesh point in the far downstairs bedroom and one upstairs,
 * all three hearing each other on every band, in the US, with a faint
 * neighbour's network next door on 5 GHz.
 */
export function threeApHome(): Plan {
  const result = parsePlan(threeApJson)
  if (!result.ok) throw new Error('three-ap-home.json is invalid')
  return result.plan
}

/**
 * The naive placement the optimizer must beat (D47): the middle of the
 * floor's bounding box, or the nearest spot the scorer allows (on a 10 cm
 * lattice) when that is outside the walls or on one, as in an L-shape.
 */
export function naiveCentre(plan: Plan, floorId: string, scorer: Scorer) {
  const { nodes } = plan.floors.find((f) => f.id === floorId)!
  const xs = nodes.map((n) => n.x)
  const ys = nodes.map((n) => n.y)
  const middle = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
    floorId,
  }
  if (scorer.allows(middle)) return middle
  const distance = (p: { x: number; y: number }) =>
    Math.hypot(p.x - middle.x, p.y - middle.y)
  const onFloor = candidatePositions(scorer, 0.1).filter(
    (at) => at.floorId === floorId,
  )
  return onFloor.reduce((a, b) => (distance(b) < distance(a) ? b : a))
}

/**
 * A floor of 5 × 5 rooms, each `roomW` × `roomH` metres: 60 walls, a door in
 * every interior wall and a window in every outside wall, with an access
 * point at each of `accessPoints`.
 */
function rooms(
  name: string,
  roomW: number,
  roomH: number,
  accessPoints: readonly [number, number][],
): Plan {
  const rooms = 5
  const nodes: PlanNode[] = []
  for (let row = 0; row <= rooms; row++) {
    for (let col = 0; col <= rooms; col++) {
      nodes.push({ id: `n${row}-${col}`, x: col * roomW, y: row * roomH })
    }
  }
  const walls: Wall[] = []
  const openings: Opening[] = []
  const addWall = (from: string, to: string, outside: boolean) => {
    const id = `w${walls.length}`
    walls.push({
      id,
      from,
      to,
      material: outside ? ('brick' as const) : ('drywall' as const),
    })
    openings.push(
      outside
        ? {
            id: `o${openings.length}`,
            wallId: id,
            kind: 'window' as const,
            offsetM: 0.4,
            widthM: 1.2,
            material: 'glass' as const,
          }
        : {
            id: `o${openings.length}`,
            wallId: id,
            kind: 'door' as const,
            offsetM: 0.6,
            widthM: 0.81,
            material: 'wood' as const,
          },
    )
  }
  for (let row = 0; row <= rooms; row++) {
    for (let col = 0; col < rooms; col++) {
      const outside = row === 0 || row === rooms
      addWall(`n${row}-${col}`, `n${row}-${col + 1}`, outside)
    }
  }
  for (let col = 0; col <= rooms; col++) {
    for (let row = 0; row < rooms; row++) {
      const outside = col === 0 || col === rooms
      addWall(`n${row}-${col}`, `n${row + 1}-${col}`, outside)
    }
  }
  const radios = [
    { band: '2.4GHz' as const },
    { band: '5GHz' as const },
    { band: '6GHz' as const },
  ]
  const result = parsePlan({
    schemaVersion: 1,
    name,
    floors: [
      {
        id: 'main',
        name: 'Main floor',
        elevationM: 0,
        heightM: 2.4,
        nodes,
        walls,
        openings,
      },
    ],
    accessPoints: accessPoints.map(([x, y], i) => ({
      id: `ap${i}`,
      name: `AP ${i + 1}`,
      floorId: 'main',
      x,
      y,
      heightM: 1,
      radios,
    })),
  })
  if (!result.ok) throw new Error(`${name} is invalid`)
  return result.plan
}

/**
 * A 10 × 10 m floor of 2 m square rooms with two access points: far busier
 * than a real home of this size.
 */
export const roomGrid = () =>
  rooms('Room grid', 2, 2, [
    [3, 3],
    [7, 7],
  ])

/**
 * A 20 × 15 m (300 m²) house of 4 × 3 m rooms with two access points: a large
 * home, the plan behind the 4× slower device target (D29).
 */
export const bigHouse = () =>
  rooms('Big house', 4, 3, [
    [5, 4],
    [15, 11],
  ])

/**
 * A two-storey house (#87): two 15 × 10 m (150 m²) floors of 3 × 2 m rooms,
 * 300 m² in all, with a timber joist floor between, the router downstairs and
 * a second access point upstairs, and a 1 × 3 m stairwell through the upper
 * floor (D54). As large as the big house, so it has the same budget (D29).
 */
export function twoStoreyHouse(): Plan {
  const ground = rooms('Two-storey house', 3, 2, [[4, 3]])
  const upper = rooms('Upstairs', 3, 2, [[11, 7]])
  const upstairs: Floor = {
    ...upper.floors[0]!,
    id: 'up',
    name: 'Upstairs',
    elevationM: 2.7,
    material: 'timber-joist',
    floorOpenings: [
      {
        id: 'stairs',
        points: [
          { x: 6, y: 4 },
          { x: 7, y: 4 },
          { x: 7, y: 7 },
          { x: 6, y: 7 },
        ],
      },
    ],
  }
  return {
    ...ground,
    floors: [...ground.floors, upstairs],
    accessPoints: [
      ...ground.accessPoints,
      ...upper.accessPoints.map((ap) => ({ ...ap, id: 'up0', floorId: 'up' })),
    ],
  }
}

/** A drywall outline of a w × h room, optionally split at x = splitX. */
export function room(
  w: number,
  h: number,
  split?: { x: number; material: WallMaterial },
): Floor {
  const corners = split
    ? [
        [0, 0],
        [split.x, 0],
        [w, 0],
        [w, h],
        [split.x, h],
        [0, h],
      ]
    : [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]
  const walls = corners.map((_, i) => ({
    id: `w${i}`,
    from: `n${i}`,
    to: `n${(i + 1) % corners.length}`,
    material: 'drywall' as WallMaterial,
  }))
  if (split) {
    walls.push({ id: 'split', from: 'n1', to: 'n4', material: split.material })
  }
  return {
    id: 'f',
    name: 'Floor',
    elevationM: 0,
    heightM: 2.5,
    nodes: corners.map(([x, y], i) => ({ id: `n${i}`, x: x!, y: y! })),
    walls,
    openings: [],
  }
}

/** An access point at receiver height, so distances are flat. */
export const ap = (x: number, y: number): AccessPoint => ({
  id: `ap-${x}-${y}`,
  name: 'AP',
  floorId: 'f',
  x,
  y,
  heightM: 1,
  radios: [{ band: '5GHz' }],
})

/** Free-space signal at distance d on 5 GHz at the default power. */
export function freeSpaceDbm(d: number): number {
  const p = BAND_PROFILES['5GHz']
  return (
    p.defaultTxPowerDbm -
    p.referenceLossDb -
    10 * p.pathLossExponent * Math.log10(Math.max(d, 1))
  )
}

/**
 * A spot in every room of a 5 × 5 grid of `roomW` × `roomH` rooms, a little
 * off each room's middle so paths don't run along walls, with a reading
 * from every radio of every access point (to be filled in by `simulate`).
 */
export function roomSpots(
  plan: Plan,
  roomW: number,
  roomH: number,
  prefix = 's',
): SurveySpot[] {
  const spots: SurveySpot[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      spots.push({
        id: `${prefix}${row}-${col}`,
        x: (col + 0.43) * roomW,
        y: (row + 0.61) * roomH,
        readings: plan.accessPoints.flatMap((ap) =>
          ap.radios.map((radio) => ({
            apId: ap.id,
            band: radio.band,
            dbm: -60,
          })),
        ),
      })
    }
  }
  return spots
}

/** Standard normal numbers from a seeded generator (Box–Muller). */
function gaussian(seed: number) {
  const random = mulberry32(seed)
  return () =>
    Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
}

/**
 * Replaces every survey reading with what the model predicts under `truth`,
 * plus a device offset and Gaussian noise of `sigmaDb` (D75).
 */
export function simulate(
  plan: Plan,
  truth: Calibration,
  offsetDb: number,
  sigmaDb: number,
  seed = 1,
): Plan {
  const noise = gaussian(seed)
  const predicted = new Map(
    predictReadings(plan, truth).map((r) => [
      `${r.spotId} ${r.index}`,
      r.predictedDbm,
    ]),
  )
  return {
    ...plan,
    floors: plan.floors.map((floor) => ({
      ...floor,
      surveySpots: floor.surveySpots?.map((spot) => ({
        ...spot,
        readings: spot.readings.map((reading, index) => ({
          ...reading,
          dbm:
            predicted.get(`${spot.id} ${index}`)! +
            offsetDb +
            sigmaDb * noise(),
        })),
      })),
    })),
  }
}

/** The big house with a spot in each of its 25 rooms. */
export function surveyedBigHouse(): Plan {
  const plan = bigHouse()
  return {
    ...plan,
    floors: plan.floors.map((floor) => ({
      ...floor,
      surveySpots: roomSpots(plan, 4, 3),
    })),
  }
}

/** The two-storey house with a spot in each of its 50 rooms. */
export function surveyedTwoStorey(): Plan {
  const plan = twoStoreyHouse()
  return {
    ...plan,
    floors: plan.floors.map((floor, i) => ({
      ...floor,
      surveySpots: roomSpots(plan, 3, 2, `f${i}-`),
    })),
  }
}

/**
 * The survey in surveyed-home.json (D76): the sample bungalow with 11 spots
 * across its 7 rooms, each read from the router on every band. Its readings
 * are the model under `SURVEYED_HOME_TRUTH`, a phone reading 5 dB low and
 * 2 dB of noise, to 0.1 dB.
 */
export function surveyedHomeSpots(plan: Plan): SurveySpot[] {
  const at: [number, number][] = [
    [2.45, 1.95],
    [1.4, 1.2],
    [7.95, 4.95],
    [6.5, 2.5],
    [9.5, 7.5],
    [12.95, 1.95],
    [13.8, 1.2],
    [2.45, 4.95],
    [12.95, 5.45],
    [2.45, 7.95],
    [12.95, 8.45],
  ]
  return at.map(([x, y], i) => ({
    id: `spot${i + 1}`,
    x,
    y,
    readings: plan.accessPoints.flatMap((a) =>
      a.radios.map((radio) => ({ apId: a.id, band: radio.band, dbm: -60 })),
    ),
  }))
}

export const SURVEYED_HOME_TRUTH = {
  calibration: {
    '2.4GHz': { pathLossExponent: 2.25 },
    '5GHz': { pathLossExponent: 2.25 },
    '6GHz': { pathLossExponent: 2.25 },
  } satisfies Calibration,
  offsetDb: -5,
  sigmaDb: 2,
  seed: 7,
}
