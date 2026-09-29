import type { Band, ChannelWidth, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  accessPointLinks,
  candidateChoices,
  CCA_DBM,
  compareCost,
  overlapMHz,
  planBandChannels,
  type Choice,
  type PlanCost,
} from './channelPlan.ts'
import { threeApHome } from './testPlans.ts'

/**
 * Phase 6 exit gate (D61, D69): on a three-AP home, the planner finds a
 * channel plan with no same-channel neighbours where one exists, and gives
 * the least-bad one, saying so, where none does.
 *
 * The home is the two-storey sample with the router downstairs, a mesh point
 * in the far downstairs bedroom and one upstairs: all three hear each other
 * through walls and the floor, so they need three channels that don't
 * overlap. At 80 MHz on 5 GHz the US has only two without DFS (42 and 155),
 * so there no plan keeps them apart; with DFS allowed it has six.
 *
 * Each plan is checked against brute force over every assignment of the
 * channels the planner may use (the region's, with DFS as set, and 1, 6 and
 * 11 on 2.4 GHz), each costed here from the access points' signals at each
 * other, independently of the search.
 */

/** Every radio on a band set to one width by hand, channels left on Auto. */
function withWidth(plan: Plan, band: Band, widthMHz: ChannelWidth): Plan {
  return {
    ...plan,
    accessPoints: plan.accessPoints.map((ap) => ({
      ...ap,
      radios: ap.radios.map((r) =>
        r.band === band ? { ...r, channelWidthMHz: widthMHz } : r,
      ),
    })),
  }
}

function radiosOn(plan: Plan, band: Band) {
  return plan.accessPoints.map((ap) => ({
    ap,
    radio: ap.radios.find((r) => r.band === band)!,
  }))
}

/**
 * What an assignment costs under D68's order: clashes between access points
 * that hear each other (or with a network at its CCA level), the MHz those
 * clashes share, interference in mW between every pair and from every
 * network, and how many channels need DFS.
 */
function costOf(
  plan: Plan,
  band: Band,
  picks: readonly Choice[],
  link = accessPointLinks(plan, band, radiosOn(plan, band)),
): PlanCost {
  const mw = (dbm: number) => 10 ** (dbm / 10)
  let clashes = 0
  let shared = 0
  let interference = 0
  for (let i = 0; i < picks.length; i++) {
    const a = picks[i]!
    for (let j = i + 1; j < picks.length; j++) {
      const b = picks[j]!
      const overlap = overlapMHz(band, a, b)
      if (overlap === 0) continue
      interference +=
        (overlap / b.widthMHz) * mw(link[i]![j]!) +
        (overlap / a.widthMHz) * mw(link[j]![i]!)
      const hear =
        link[i]![j]! >= CCA_DBM[b.widthMHz] ||
        link[j]![i]! >= CCA_DBM[a.widthMHz]
      if (hear) {
        clashes++
        shared += overlap
      }
    }
    for (const net of plan.neighbourNetworks ?? []) {
      if (net.band !== band || net.channel === undefined) continue
      const overlap = overlapMHz(band, a, {
        channel: net.channel,
        widthMHz: net.channelWidthMHz,
      })
      if (overlap === 0) continue
      interference += (overlap / net.channelWidthMHz) * mw(net.strengthDbm)
      if (net.strengthDbm >= CCA_DBM[net.channelWidthMHz]) {
        clashes++
        shared += overlap
      }
    }
  }
  return [clashes, shared, interference, picks.filter((p) => p.dfs).length]
}

/** The cheapest of every assignment, by walking them all. */
function bruteForce(
  plan: Plan,
  band: Band,
  widthMHz: ChannelWidth,
): { cost: PlanCost; assignments: number } {
  const candidates = candidateChoices(
    plan.region,
    band,
    widthMHz,
    plan.allowDfs ?? false,
  )
  const n = plan.accessPoints.length
  const link = accessPointLinks(plan, band, radiosOn(plan, band))
  let best: PlanCost | undefined
  let assignments = 0
  const picks: Choice[] = []
  const walk = (i: number) => {
    if (i === n) {
      assignments++
      const cost = costOf(plan, band, picks, link)
      if (!best || compareCost(cost, best) < 0) best = cost
      return
    }
    for (const c of candidates) {
      picks[i] = c
      walk(i + 1)
    }
  }
  walk(0)
  return { cost: best!, assignments }
}

/** The planner's plan for a band, as choices in access point order. */
function planned(plan: Plan, band: Band) {
  const result = planBandChannels(plan, band)!
  const picks = plan.accessPoints.map((ap) => {
    const r = result.radios.find((p) => p.accessPointId === ap.id)!
    return { channel: r.channel, widthMHz: r.widthMHz, dfs: r.dfs }
  })
  return { result, picks, cost: costOf(plan, band, picks) }
}

describe('Phase 6 exit gate: channels for a three-AP home (D69)', () => {
  it('has three access points on two floors that all hear each other', () => {
    const plan = threeApHome()
    expect(plan.accessPoints).toHaveLength(3)
    expect(new Set(plan.accessPoints.map((ap) => ap.floorId)).size).toBe(2)
    for (const band of ['2.4GHz', '5GHz', '6GHz'] as const) {
      const link = accessPointLinks(plan, band, radiosOn(plan, band))
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          // Heard even at 160 MHz's CCA level, the least sensitive.
          if (i !== j) expect(link[i]![j]!).toBeGreaterThan(CCA_DBM[160])
        }
      }
    }
  })

  describe('where a clash-free plan exists', () => {
    const cases = [
      { name: '5 GHz at 80 MHz with DFS', band: '5GHz', width: 80, dfs: true },
      { name: '2.4 GHz at 20 MHz', band: '2.4GHz', width: 20, dfs: false },
      { name: '6 GHz at 80 MHz', band: '6GHz', width: 80, dfs: false },
    ] as const
    for (const { name, band, width, dfs } of cases) {
      it(`${name}: finds it, and brute force agrees it's the best`, () => {
        const plan = withWidth({ ...threeApHome(), allowDfs: dfs }, band, width)
        const { result, picks, cost } = planned(plan, band)
        const brute = bruteForce(plan, band, width)
        expect(brute.cost[0]).toBe(0)
        expect(result.clashes).toBe(0)
        expect(result.exact).toBe(true)
        expect(compareCost(cost, brute.cost)).toBe(0)
        // No two of them overlap at all, since all three hear each other.
        for (let i = 0; i < 3; i++) {
          for (let j = i + 1; j < 3; j++) {
            expect(overlapMHz(band, picks[i]!, picks[j]!)).toBe(0)
          }
        }
        expect(result.radios.every((r) => r.clashesWith.length === 0)).toBe(
          true,
        )
      })
    }

    it('5 GHz with DFS avoids the neighbour’s network, using DFS channels', () => {
      const plan = withWidth({ ...threeApHome(), allowDfs: true }, '5GHz', 80)
      const { result } = planned(plan, '5GHz')
      expect(
        result.radios.every((r) =>
          r.networks.every((n) => n.id === 'next-door' && !n.overlaps),
        ),
      ).toBe(true)
      // 42 is next door's, so the other two need DFS.
      expect(result.radios.filter((r) => r.dfs)).toHaveLength(2)
      // Without them, one clash would be left, as in the case below.
      expect(result.withoutDfs).toEqual({
        clashes: 1,
        autoWidthMHz: 80,
        worse: 'clashes',
      })
    })

    it('5 GHz on Auto without DFS narrows to 40 MHz to stay clash-free', () => {
      const result = planBandChannels(threeApHome(), '5GHz')!
      expect(result.clashes).toBe(0)
      expect(result.autoWidthMHz).toBe(40)
      expect(result.usualWidthMHz).toBe(80)
      expect(result.withDfs).toEqual({ clashes: 0, autoWidthMHz: 80 })
    })
  })

  describe('where none exists: 5 GHz at 80 MHz without DFS', () => {
    const plan = () => withWidth(threeApHome(), '5GHz', 80)

    it('leaves one clash, the fewest possible, and brute force agrees', () => {
      const { result, cost } = planned(plan(), '5GHz')
      const brute = bruteForce(plan(), '5GHz', 80)
      expect(brute.assignments).toBe(8) // 2 channels, 3 access points
      expect(brute.cost[0]).toBe(1)
      expect(result.clashes).toBe(1)
      expect(result.exact).toBe(true)
      expect(compareCost(cost, brute.cost)).toBe(0)
    })

    it('puts the clash on the pair that hear each other most faintly', () => {
      const p = plan()
      const { result } = planned(p, '5GHz')
      const link = accessPointLinks(p, '5GHz', radiosOn(p, '5GHz'))
      const ids = p.accessPoints.map((ap) => ap.id)
      // Weakest link, both ways: the two mesh points (−57 dBm).
      const pairs = [
        [0, 1],
        [0, 2],
        [1, 2],
      ] as const
      const faintest = pairs.reduce((a, b) =>
        link[a[0]]![a[1]]! + link[a[1]]![a[0]]! <
        link[b[0]]![b[1]]! + link[b[1]]![b[0]]!
          ? a
          : b,
      )
      const clashing = result.radios
        .filter((r) => r.clashesWith.length > 0)
        .map((r) => r.accessPointId)
      expect(clashing).toEqual([ids[faintest[0]], ids[faintest[1]]])
    })

    it('says allowing DFS channels would clear it', () => {
      const result = planBandChannels(plan(), '5GHz')!
      expect(result.withDfs).toEqual({ clashes: 0, autoWidthMHz: 80 })
    })
  })
})
