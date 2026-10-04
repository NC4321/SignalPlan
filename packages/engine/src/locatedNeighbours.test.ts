import type { AccessPoint, NeighbourNetwork, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  accessPointLinks,
  CCA_DBM,
  neighbourLinks,
  planBandChannels,
} from './channelPlan.ts'
import { evaluateCoverage, type Coverage } from './coverage.ts'
import {
  neighbourBackground,
  sinrDb,
  sourceTunings,
  type NeighbourSource,
} from './interference.ts'
import { twoStoreyHouse } from './testPlans.ts'

/**
 * Neighbours' networks with a location (D84): their signal is predicted as
 * an access point's would be, at their fitted power.
 */

const location = {
  floorId: 'up',
  x: -3.2,
  y: 6.4,
  heightM: 1.5,
  eirpDbm: 19,
  uncertaintyM: 2,
}

function withNeighbours(networks: NeighbourNetwork[]): Plan {
  const plan = twoStoreyHouse()
  return {
    ...plan,
    accessPoints: plan.accessPoints.map((a) => ({
      ...a,
      radios: a.radios.map((r) => ({
        ...r,
        channel: 36,
        channelWidthMHz: 20 as const,
      })),
    })),
    neighbourNetworks: networks,
  }
}

const located: NeighbourNetwork = {
  id: 'next',
  band: '5GHz',
  channel: 36,
  channelWidthMHz: 20,
  strengthDbm: -70,
  location,
}

/** An access point standing where the neighbour is, at its power. */
const standIn: AccessPoint = {
  id: 'stand-in',
  name: 'Stand-in',
  floorId: location.floorId,
  x: location.x,
  y: location.y,
  heightM: location.heightM,
  radios: [{ band: '5GHz', txPowerDbm: location.eirpDbm }],
}

describe('coverage of located neighbours', () => {
  it('works out a located neighbour exactly as an access point there', () => {
    // Outside the walls upstairs, seen from downstairs through the floor;
    // and inside upstairs, on its own floor. (An access point outside would
    // widen its own floor's grid; a neighbour doesn't.)
    const cases = [
      { at: location, floorId: 'main' },
      { at: { ...location, x: 3.2, y: 6.4 }, floorId: 'up' },
    ]
    for (const { at, floorId } of cases) {
      const plan = withNeighbours([{ ...located, location: at }])
      const withStandIn = {
        ...plan,
        accessPoints: [...plan.accessPoints, { ...standIn, x: at.x, y: at.y }],
      }
      const coverage = evaluateCoverage(plan, floorId, '5GHz', 0.25)
      const reference = evaluateCoverage(withStandIn, floorId, '5GHz', 0.25)
      expect(coverage.neighbourIds).toEqual(['next'])
      const size = coverage.dbm.length
      expect(reference.dbm.length).toBe(size)
      const s = reference.accessPointIds.indexOf('stand-in')
      expect(coverage.neighbourDbm).toEqual(
        reference.sourceDbm.subarray(s * size, (s + 1) * size),
      )
      // It isn't a source of coverage.
      expect(coverage.accessPointIds).not.toContain('next')
      expect(coverage.dbm).toEqual(
        evaluateCoverage(withNeighbours([]), floorId, '5GHz', 0.25).dbm,
      )
    }
  })

  it('leaves out neighbours without a location or a channel, and other bands’', () => {
    const plan = withNeighbours([
      { ...located, id: 'no-location', location: undefined },
      { ...located, id: 'no-channel', channel: undefined },
      { ...located, id: 'on-2.4', band: '2.4GHz', channel: 6 },
    ])
    const five = evaluateCoverage(plan, 'main', '5GHz', 0.5)
    expect(five.neighbourIds).toEqual([])
    expect(five.neighbourDbm).toHaveLength(0)
    const two = evaluateCoverage(plan, 'main', '2.4GHz', 0.5)
    expect(two.neighbourIds).toEqual(['on-2.4'])
    expect(two.neighbourDbm).toHaveLength(two.dbm.length)
  })
})

describe('interference from located neighbours', () => {
  it('counts a located neighbour cell by cell, the others everywhere', () => {
    const plan = withNeighbours([
      located,
      { ...located, id: 'typed', location: undefined, strengthDbm: -80 },
    ])
    const coverage = evaluateCoverage(plan, 'up', '5GHz', 0.5)
    const background = neighbourBackground(plan, '5GHz', coverage)
    expect(background.map((b) => b.cells !== undefined)).toEqual([true, false])
    expect(background[0]!.cells).toEqual(coverage.neighbourDbm)
    // Without the coverage, every network counts at its strength.
    expect(
      neighbourBackground(plan, '5GHz').every((b) => b.cells === undefined),
    ).toBe(true)

    // Against the same neighbour as a constant at each cell's own value:
    // the SINR agrees cell by cell.
    const tunings = sourceTunings(coverage, plan)
    const sinr = sinrDb(coverage, tunings, background)
    const size = coverage.dbm.length
    for (const i of [0, Math.floor(size / 3), Math.floor(size / 2), size - 1]) {
      const one: Coverage = {
        ...coverage,
        dbm: coverage.dbm.subarray(i, i + 1),
        strongest: coverage.strongest.subarray(i, i + 1),
        sourceDbm: Float32Array.from(
          coverage.accessPointIds.map(
            (_, s) => coverage.sourceDbm[s * size + i]!,
          ),
        ),
      }
      const constant: NeighbourSource[] = [
        { tuning: background[0]!.tuning, dbm: coverage.neighbourDbm[i]! },
        background[1]!,
      ]
      const expected = sinrDb(one, tunings, constant)[0]!
      if (Number.isFinite(expected)) expect(sinr[i]).toBeCloseTo(expected, 4)
      else expect(sinr[i]).toBe(expected)
    }
  })

  it('lowers SINR more near the neighbour than across the home', () => {
    const quiet = withNeighbours([])
    const plan = withNeighbours([
      { ...located, location: { ...location, x: 0.5, y: 5 } },
    ])
    const coverage = evaluateCoverage(plan, 'up', '5GHz', 0.5)
    const tunings = sourceTunings(coverage, plan)
    const before = sinrDb(
      coverage,
      tunings,
      neighbourBackground(quiet, '5GHz', coverage),
    )
    const after = sinrDb(
      coverage,
      tunings,
      neighbourBackground(plan, '5GHz', coverage),
    )
    const { grid } = coverage
    const at = (x: number, y: number) =>
      Math.floor((y - grid.originY) / grid.cellM) * grid.cols +
      Math.floor((x - grid.originX) / grid.cellM)
    const near = at(1.5, 5)
    const far = at(14, 5)
    expect(before[near]! - after[near]!).toBeGreaterThan(
      before[far]! - after[far]! + 3,
    )
  })
})

describe('the channel planner and located neighbours', () => {
  it('has a located neighbour’s signal at each access point as an access point’s', () => {
    const plan = withNeighbours([located])
    const withStandIn = {
      ...plan,
      accessPoints: [standIn, ...plan.accessPoints],
    }
    const nodes = withStandIn.accessPoints.map((a) => ({
      ap: a,
      radio: a.radios.find((r) => r.band === '5GHz')!,
    }))
    const links = accessPointLinks(withStandIn, '5GHz', nodes)
    const at = neighbourLinks(plan, '5GHz', plan.accessPoints).get('next')!
    plan.accessPoints.forEach((_, i) => {
      expect(at[i]).toBeCloseTo(links[i + 1]![0]!, 9)
    })
    // A network without a location has none.
    expect(
      neighbourLinks(
        withNeighbours([{ ...located, location: undefined }]),
        '5GHz',
        plan.accessPoints,
      ).size,
    ).toBe(0)
  })

  it('treats a located neighbour as strong only where it’s heard at CCA', () => {
    // A neighbour just outside the downstairs router's wall: heard
    // strongly downstairs, faintly by the access point upstairs and across.
    const base = twoStoreyHouse()
    const near = {
      ...located,
      location: { ...location, floorId: 'main', x: 4, y: -0.5, eirpDbm: 0 },
    }
    const plan: Plan = { ...base, neighbourNetworks: [near] }
    const at = neighbourLinks(plan, '5GHz', plan.accessPoints).get('next')!
    const cca = CCA_DBM[20]
    expect(at[0]!).toBeGreaterThanOrEqual(cca)
    expect(at[1]!).toBeLessThan(cca)
    const result = planBandChannels(plan, '5GHz')!
    const [downstairs, upstairs] = result.radios
    expect(downstairs!.networks).toEqual([
      { id: 'next', strong: true, overlaps: false },
    ])
    expect(upstairs!.networks[0]!.strong).toBe(false)
    expect(result.clashes).toBe(0)
  })
})
