import {
  parsePlan,
  type Band,
  type Opening,
  type Plan,
  type PlanNode,
  type Wall,
} from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json' with { type: 'json' }
import { describe, expect, it } from 'vitest'
import { evaluateCoverage } from './coverage.ts'

/**
 * Speed of the coverage grid against the Phase 2 budget: a 100 m² floor at
 * 10 cm cells in under 200 ms (OUTLINE.md, D11). Run with `pnpm speed`, one
 * file at a time so other tests don't compete for the CPU.
 *
 * MARGIN: to be set from the CI timings.
 */
// Both exist in Node and in Web Workers; the engine's lib has no DOM or Node types.
declare const performance: { now(): number }
declare const console: { log(...data: unknown[]): void }

const BUDGET_MS = 200
const WARM_UP_RUNS = 5
const RUNS = 30

function measure(plan: Plan, floorId: string, band: Band) {
  for (let i = 0; i < WARM_UP_RUNS; i++) evaluateCoverage(plan, floorId, band)
  const times: number[] = []
  let cells = 0
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now()
    const coverage = evaluateCoverage(plan, floorId, band)
    times.push(performance.now() - started)
    cells = coverage.grid.cols * coverage.grid.rows
  }
  times.sort((a, b) => a - b)
  const at = (q: number) => times[Math.min(RUNS - 1, Math.floor(q * RUNS))]!
  return { median: at(0.5), p95: at(0.95), areaM2: cells * 0.01 }
}

function report(name: string, band: Band, r: ReturnType<typeof measure>) {
  console.log(
    `${name}, ${band}: median ${r.median.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms over ${RUNS} runs (${r.areaM2.toFixed(0)} m² grid, budget ${BUDGET_MS} ms)`,
  )
}

/**
 * A 10 × 10 m floor of 5 × 5 rooms, each 2 m square: 60 walls, a door in
 * every interior wall and a window in every outside wall, with two access
 * points. Far busier than a real home of this size.
 */
function roomGrid(): Plan {
  const rooms = 5
  const size = 2
  const nodes: PlanNode[] = []
  for (let row = 0; row <= rooms; row++) {
    for (let col = 0; col <= rooms; col++) {
      nodes.push({ id: `n${row}-${col}`, x: col * size, y: row * size })
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
    name: 'Room grid',
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
    accessPoints: [
      { id: 'a', name: 'A', floorId: 'main', x: 3, y: 3, heightM: 1, radios },
      { id: 'b', name: 'B', floorId: 'main', x: 7, y: 7, heightM: 1, radios },
    ],
  })
  if (!result.ok) throw new Error('room grid is invalid')
  return result.plan
}

describe('coverage grid speed at 10 cm cells', () => {
  const sample = parsePlan(sampleHome)
  if (!sample.ok) throw new Error('fixture is invalid')

  const cases: [string, Plan][] = [
    ['Sample home (150 m², 22 walls, 1 access point)', sample.plan],
    ['Room grid (100 m², 60 walls, 2 access points)', roomGrid()],
  ]
  const bands: Band[] = ['2.4GHz', '5GHz', '6GHz']

  for (const [name, plan] of cases) {
    for (const band of bands) {
      it(`${name}, ${band}`, () => {
        const r = measure(plan, 'main', band)
        report(name, band, r)
        expect(r.areaM2).toBeGreaterThanOrEqual(100)
        expect(r.median).toBeLessThan(BUDGET_MS)
      })
    }
  }
})
