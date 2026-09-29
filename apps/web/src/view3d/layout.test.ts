import type { Coverage } from '@signalplan/engine'
import type { AccessPoint, Floor, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { mapData } from '../mapView.ts'
import {
  accessPointMarkers,
  CUTAWAY_M,
  floorLayouts,
  heatmapPixels,
  sceneBounds,
  wallBoxes,
} from './layout.ts'

const floor = (id: string, elevationM: number, heightM = 2.4): Floor => ({
  id,
  name: id,
  elevationM,
  heightM,
  nodes: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 4, y: 0 },
    { id: 'c', x: 4, y: 3 },
  ],
  walls: [
    { id: 'ab', from: 'a', to: 'b', material: 'brick' },
    { id: 'bc', from: 'b', to: 'c', material: 'drywall' },
  ],
  openings: [
    {
      id: 'door',
      wallId: 'ab',
      kind: 'door',
      offsetM: 1,
      widthM: 1,
      material: 'open',
    },
  ],
})
const ap = (floorId: string, heightM: number): AccessPoint => ({
  id: `ap-${floorId}`,
  name: 'AP',
  floorId,
  x: 2,
  y: 1,
  heightM,
  radios: [{ band: '5GHz' }],
})
// Listed out of order: stacking goes by elevation.
const plan: Plan = {
  schemaVersion: 1,
  name: 'p',
  floors: [floor('up', 2.7), floor('basement', -2.7), floor('ground', 0)],
  accessPoints: [ap('ground', 2), ap('up', 1)],
}

describe('floorLayouts', () => {
  it('stacks floors by elevation, adding the spread once per floor below', () => {
    expect(floorLayouts(plan, [], 2).map((l) => [l.floor.id, l.baseM])).toEqual(
      [
        ['basement', -2.7],
        ['ground', 2],
        ['up', 6.7],
      ],
    )
  })

  it('leaves hidden floors out without moving the others', () => {
    expect(
      floorLayouts(plan, ['ground'], 2).map((l) => [l.floor.id, l.baseM]),
    ).toEqual([
      ['basement', -2.7],
      ['up', 6.7],
    ])
  })
})

describe('wallBoxes', () => {
  it('cuts walls away at 1 m, or runs them to the ceiling', () => {
    const cut = wallBoxes(floor('f', 0), false)
    // The open doorway leaves a gap: two pieces of the brick wall remain.
    expect(cut.map((w) => [w.material, w.length])).toEqual([
      ['brick', 1],
      ['brick', 2],
      ['drywall', 3],
    ])
    expect(cut.every((w) => w.height === CUTAWAY_M)).toBe(true)
    expect(wallBoxes(floor('f', 0), true)[0]!.height).toBe(2.4)
    // Never above a low ceiling.
    expect(wallBoxes(floor('f', 0, 0.8), false)[0]!.height).toBe(0.8)
  })

  it('places each box at its middle, turned along the wall', () => {
    const drywall = wallBoxes(floor('f', 0), false)[2]!
    expect(drywall).toMatchObject({ x: 4, y: 1.5, opening: false })
    expect(drywall.angle).toBeCloseTo(Math.PI / 2, 12)
  })
})

describe('accessPointMarkers and sceneBounds', () => {
  it('puts access points at their floor plus mounting height', () => {
    const layouts = floorLayouts(plan, ['basement'], 1)
    expect(
      accessPointMarkers(plan, layouts).map((m) => [m.ap.id, m.heightM]),
    ).toEqual([
      ['ap-ground', 3],
      ['ap-up', 5.7],
    ])
    expect(sceneBounds(plan, layouts)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 4,
      maxY: 3,
      bottomM: 1,
      topM: 4.7 + 2.4,
    })
    expect(sceneBounds(plan, [])).toBeUndefined()
  })
})

describe('heatmapPixels', () => {
  const coverage = (dbm: number[], floorArea: number[]): Coverage => ({
    grid: { originX: 0, originY: 0, cellM: 1, cols: dbm.length, rows: 1 },
    band: '5GHz',
    dbm: Float32Array.from(dbm),
    strongest: new Int16Array(dbm.length),
    floorArea: Uint8Array.from(floorArea),
    accessPointIds: [],
    sourceDbm: new Float32Array(0),
  })
  // Coloured as the Signal map, which these tests are about.
  const signal = (dbm: number[], floorArea: number[]) =>
    mapData(
      coverage(dbm, floorArea),
      'signal',
      { overlapMarginDb: 8, roamThresholdDbm: -70 },
      { accessPoints: [] },
    )

  it('colours the floor, greys it where there is no signal, clears the rest', () => {
    const pixels = heatmapPixels(signal([-40, -95, -40], [1, 1, 0]))
    // Excellent (viridis yellow), no signal (grey), outside (clear).
    expect([...pixels]).toEqual([
      0xfd, 0xe7, 0x25, 235, 160, 160, 160, 200, 0, 0, 0, 0,
    ])
  })

  it('shows the heatmap everywhere, fainter, with no closed outline', () => {
    const pixels = heatmapPixels(signal([-40, -95], [0, 0]))
    expect([...pixels]).toEqual([0xfd, 0xe7, 0x25, 140, 0, 0, 0, 0])
  })
})
