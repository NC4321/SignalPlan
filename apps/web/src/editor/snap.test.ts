import type { Floor } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { angleSnap, bearingDeg, pointAtBearing, snapPoint } from './snap.ts'

/** One wall from (0, 0) to (4, 0). */
const floor: Floor = {
  id: 'f',
  name: 'Floor',
  elevationM: 0,
  heightM: 2.5,
  nodes: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 4, y: 0 },
  ],
  walls: [{ id: 'w', from: 'a', to: 'b', material: 'brick' }],
  openings: [],
}

// 100 px per metre, so the 10 px snap radius is 10 cm.
const options = { scale: 100, units: 'metric' as const }

describe('snapPoint', () => {
  it('snaps to a nearby corner first', () => {
    expect(snapPoint(floor, { x: 4.06, y: 0.05 }, options)).toEqual({
      point: { x: 4, y: 0 },
      kind: 'node',
    })
  })

  it('snaps onto a nearby wall', () => {
    const snap = snapPoint(floor, { x: 2.33, y: 0.07 }, options)
    expect(snap.kind).toBe('wall')
    expect(snap.point.y).toBeCloseTo(0, 9)
    expect(snap.point.x).toBeCloseTo(2.33, 9)
  })

  it('snaps to the grid when not drawing', () => {
    const snap = snapPoint(floor, { x: 1.234, y: 2.26 }, options)
    expect(snap.kind).toBe('grid')
    expect(snap.point.x).toBeCloseTo(1.2, 9)
    expect(snap.point.y).toBeCloseTo(2.3, 9)
  })

  it('snaps imperial grid points to whole inches', () => {
    const snap = snapPoint(
      floor,
      { x: 1, y: 2 },
      { ...options, units: 'imperial' },
    )
    expect((snap.point.x / 0.0254) % 1).toBeCloseTo(0, 6)
  })

  it('snaps direction and length when drawing from an anchor', () => {
    const snap = snapPoint(
      floor,
      { x: 1.03, y: 2.97 },
      {
        ...options,
        anchor: { x: 1, y: 1 },
      },
    )
    expect(snap.kind).toBe('angle')
    expect(snap.point.x).toBeCloseTo(1, 9) // straight down (90°)
    expect(snap.point.y).toBeCloseTo(3, 9)
  })

  it('meets a wall along the snapped direction when both apply', () => {
    // From (1, 2) toward the wall at a shallow angle off vertical.
    const snap = snapPoint(
      floor,
      { x: 1.04, y: 0.03 },
      {
        ...options,
        anchor: { x: 1, y: 2 },
      },
    )
    expect(snap.kind).toBe('wall')
    expect(snap.point.x).toBeCloseTo(1, 9)
    expect(snap.point.y).toBeCloseTo(0, 9)
  })

  it('does nothing while snapping is disabled', () => {
    const raw = { x: 4.01, y: 0.01 }
    expect(snapPoint(floor, raw, { ...options, disabled: true })).toEqual({
      point: raw,
      kind: 'none',
    })
  })
})

describe('angles', () => {
  it('rounds to 15° steps', () => {
    const snapped = angleSnap({ x: 0, y: 0 }, { x: 1, y: -0.29 }, 'metric')
    // atan(0.29) ≈ 16°, so 15° up (y is negative upward on the plan).
    expect(bearingDeg({ x: 0, y: 0 }, snapped)).toBeCloseTo(15, 6)
  })

  it('measures bearings counter-clockwise from east, y down', () => {
    const o = { x: 0, y: 0 }
    expect(bearingDeg(o, { x: 1, y: 0 })).toBeCloseTo(0)
    expect(bearingDeg(o, { x: 0, y: -1 })).toBeCloseTo(90)
    expect(bearingDeg(o, { x: -1, y: 0 })).toBeCloseTo(180)
    expect(bearingDeg(o, { x: 0, y: 1 })).toBeCloseTo(270)
  })

  it('places a point at a bearing and length', () => {
    const q = pointAtBearing({ x: 1, y: 1 }, 2, 90)
    expect(q.x).toBeCloseTo(1, 9)
    expect(q.y).toBeCloseTo(-1, 9)
  })
})
