import type { Band, Plan } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import {
  accessPointLinks,
  candidateChoices,
  CCA_DBM,
  colourChannels,
  compareCost,
  overlapMHz,
  planBandChannels,
  planChannels,
  type Choice,
  type ColouringProblem,
  type PlanCost,
} from './channelPlan.ts'
import { ap, freeSpaceDbm, room } from './testPlans.ts'

const c = (channel: number, widthMHz: Choice['widthMHz'] = 20, dfs = false) =>
  ({ channel, widthMHz, dfs }) as Choice

/** A problem where `edges` join radios, all free to pick from `candidates`. */
function graph(
  n: number,
  edges: [number, number][],
  candidates: Choice[],
  band: Band = '5GHz',
): ColouringProblem {
  const heard = Array.from({ length: n }, () => Array<boolean>(n).fill(false))
  for (const [a, b] of edges) {
    heard[a]![b] = true
    heard[b]![a] = true
  }
  return {
    band,
    radios: Array.from({ length: n }, () => ({ fixed: undefined, candidates })),
    heard,
    // Weak links everywhere, so interference only breaks ties.
    linkMw: Array.from({ length: n }, () => Array<number>(n).fill(1e-12)),
    networks: [],
  }
}

/** Every assignment, for checking the search is exact. */
function bruteForce(problem: ColouringProblem): PlanCost {
  let best: PlanCost | undefined
  const n = problem.radios.length
  const pick: Choice[] = []
  const walk = (i: number) => {
    if (i === n) {
      const fixed: ColouringProblem = {
        ...problem,
        radios: pick.map((choice, k) => ({
          fixed: problem.radios[k]!.fixed ?? choice,
          candidates: [],
        })),
      }
      // With every radio fixed, the search only adds up the cost; DFS is
      // counted for the ones it chose.
      const cost = colourChannels(fixed).cost
      const dfs = pick.filter(
        (p, k) => !problem.radios[k]!.fixed && p.dfs,
      ).length
      const total: PlanCost = [cost[0], cost[1], cost[2], dfs]
      if (!best || compareCost(total, best) < 0) best = total
      return
    }
    const r = problem.radios[i]!
    for (const choice of r.fixed ? [r.fixed] : r.candidates) {
      pick[i] = choice
      walk(i + 1)
    }
  }
  walk(0)
  return best!
}

describe('CCA levels (D68)', () => {
  it('are 802.11ac Table 22-27’s, 3 dB up per doubling of width', () => {
    expect(CCA_DBM).toEqual({ 20: -82, 40: -79, 80: -76, 160: -73 })
  })
})

describe('overlapMHz', () => {
  it('counts shared MHz, and none for channels that only touch', () => {
    // 2.4 GHz 1 is 2402–2422 MHz, 3 is 2412–2432, 5 is 2422–2442.
    expect(overlapMHz('2.4GHz', c(1), c(3))).toBe(10)
    expect(overlapMHz('2.4GHz', c(1), c(5))).toBe(0)
    // 5 GHz 42 at 80 MHz (5170–5250) holds 36 (5170–5190) whole.
    expect(overlapMHz('5GHz', c(42, 80), c(36))).toBe(20)
    expect(overlapMHz('5GHz', c(42, 80), c(155, 80))).toBe(0)
  })
})

describe('colourChannels', () => {
  const two = [c(36), c(44)]
  const three = [c(36), c(44), c(149)]

  it('colours a path with two channels', () => {
    const result = colourChannels(
      graph(
        3,
        [
          [0, 1],
          [1, 2],
        ],
        two,
      ),
    )
    expect(result.cost[0]).toBe(0)
    expect(result.exact).toBe(true)
    const [a, b, d] = result.choices.map((x) => x.channel)
    expect(a).not.toBe(b)
    expect(d).not.toBe(b)
  })

  it('leaves one clash in a triangle with two channels, none with three', () => {
    const triangle: [number, number][] = [
      [0, 1],
      [1, 2],
      [0, 2],
    ]
    expect(colourChannels(graph(3, triangle, two)).cost[0]).toBe(1)
    expect(colourChannels(graph(3, triangle, three)).cost[0]).toBe(0)
  })

  it('keeps a hand-set channel and steers the others around it', () => {
    const problem = graph(2, [[0, 1]], two)
    const fixed: ColouringProblem = {
      ...problem,
      radios: [{ fixed: c(44), candidates: [] }, problem.radios[1]!],
    }
    const result = colourChannels(fixed)
    expect(result.choices.map((x) => x.channel)).toEqual([44, 36])
  })

  it('counts a strong neighbour’s network as a clash, a weak one only as a tie-break', () => {
    const problem = graph(1, [], two)
    const strong = colourChannels({
      ...problem,
      networks: [
        { id: 'n', channel: 36, widthMHz: 20, mw: 1e-6, strong: true },
      ],
    })
    expect(strong.choices[0]!.channel).toBe(44)
    expect(strong.cost[0]).toBe(0)
    // With both channels taken by strong networks, one clash is left.
    const both = colourChannels({
      ...problem,
      networks: [
        { id: 'n', channel: 36, widthMHz: 20, mw: 1e-6, strong: true },
        { id: 'm', channel: 44, widthMHz: 20, mw: 1e-9, strong: true },
      ],
    })
    expect(both.cost[0]).toBe(1)
    // The weaker of the two is the one shared.
    expect(both.choices[0]!.channel).toBe(44)
  })

  it('puts access points that hear each other apart before avoiding a weak network', () => {
    const problem = graph(2, [[0, 1]], two)
    const result = colourChannels({
      ...problem,
      networks: [
        { id: 'n', channel: 36, widthMHz: 20, mw: 1e-5, strong: false },
      ],
    })
    expect(result.cost[0]).toBe(0)
    expect(result.choices.map((x) => x.channel).sort()).toEqual([36, 44])
  })

  it('prefers a channel without DFS when it’s otherwise as good', () => {
    const result = colourChannels(graph(1, [], [c(52, 20, true), c(149)]))
    expect(result.choices[0]!.channel).toBe(149)
    expect(result.cost[3]).toBe(0)
  })

  it('spreads access points that don’t hear each other by interference', () => {
    // Not neighbours, but 1 hears 0 at 10⁻⁹ mW: better on different channels.
    const problem = graph(2, [], two)
    const result = colourChannels({
      ...problem,
      linkMw: [
        [0, 1e-9],
        [1e-9, 0],
      ],
    })
    expect(result.choices[0]!.channel).not.toBe(result.choices[1]!.channel)
  })

  it('matches brute force on every small graph', () => {
    // Every graph on 4 radios (64 edge sets), with 2 and 3 channels, one
    // radio fixed half the time, and a strong network on 44 in some.
    const pairs: [number, number][] = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]
    for (let mask = 0; mask < 64; mask++) {
      const edges = pairs.filter((_, k) => mask & (1 << k))
      for (const candidates of [two, three]) {
        const base = graph(4, edges, candidates)
        const variants: ColouringProblem[] = [
          base,
          {
            ...base,
            radios: [{ fixed: c(36), candidates: [] }, ...base.radios.slice(1)],
            linkMw: base.linkMw.map((row, i) =>
              row.map((_, j) => 10 ** (-9 - ((i * 4 + j) % 5) / 10)),
            ),
          },
          {
            ...base,
            networks: [
              {
                id: 'n',
                channel: 44,
                widthMHz: 20,
                mw: 1e-8,
                strong: mask % 3 === 0,
              },
            ],
          },
        ]
        for (const problem of variants) {
          const result = colourChannels(problem)
          expect(result.exact).toBe(true)
          expect(compareCost(result.cost, bruteForce(problem))).toBe(0)
        }
      }
    }
  })

  it('matches brute force on 2.4 GHz at 40 MHz, where channels partly overlap', () => {
    // EU 40 MHz channels 3–11 overlap each other by different amounts, so
    // they can't be treated as interchangeable.
    const forty = candidateChoices('EU', '2.4GHz', 40, false)
    // The reviewer's case: F on 1 hears A; A hears B; B doesn't hear F.
    const found = {
      ...graph(
        3,
        [
          [0, 1],
          [0, 2],
        ],
        forty,
        '2.4GHz',
      ),
    }
    found.radios = [
      { fixed: c(1), candidates: [] },
      { fixed: undefined, candidates: forty },
      { fixed: undefined, candidates: forty },
    ]
    const result = colourChannels(found)
    expect(result.cost[0]).toBe(0)
    expect(compareCost(result.cost, bruteForce(found))).toBe(0)

    const pairs: [number, number][] = [
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 2],
      [1, 3],
      [2, 3],
    ]
    for (const fixedOn of [1, 6, 13]) {
      for (let mask = 0; mask < 64; mask++) {
        const problem = graph(
          4,
          pairs.filter((_, k) => mask & (1 << k)),
          forty,
          '2.4GHz',
        )
        problem.radios = [
          { fixed: c(fixedOn), candidates: [] },
          ...problem.radios.slice(1),
        ]
        const got = colourChannels(problem)
        expect(got.exact).toBe(true)
        expect(compareCost(got.cost, bruteForce(problem))).toBe(0)
      }
    }
  })

  it('stops at its node limit with a full plan, not proven best', () => {
    const everyone: [number, number][] = []
    for (let a = 0; a < 8; a++)
      for (let b = a + 1; b < 8; b++) everyone.push([a, b])
    const result = colourChannels(graph(8, everyone, three), 50)
    expect(result.exact).toBe(false)
    expect(result.choices).toHaveLength(8)
  })
})

describe('candidateChoices', () => {
  it('offers only the usual gapped 2.4 GHz channels', () => {
    const us = candidateChoices('US', '2.4GHz', 20, false).map((x) => x.channel)
    const eu = candidateChoices('EU', '2.4GHz', 20, false).map((x) => x.channel)
    expect(us).toEqual([1, 6, 11])
    expect(eu).toEqual([1, 5, 9, 13])
  })

  it('offers DFS channels only when allowed', () => {
    const off = candidateChoices('US', '5GHz', 80, false)
    const on = candidateChoices('US', '5GHz', 80, true)
    expect(off.map((x) => x.channel)).toEqual([42, 155])
    expect(on.length).toBeGreaterThan(off.length)
    expect(on.filter((x) => x.dfs).map((x) => x.channel)).toContain(58)
  })
})

/** Access points in one open 30 × 20 m room, at receiver height. */
function home(points: [number, number][], extra: Partial<Plan> = {}): Plan {
  return {
    schemaVersion: 1,
    name: 'Test',
    floors: [room(30, 20)],
    accessPoints: points.map(([x, y], i) => ({
      ...ap(x, y),
      id: `a${i}`,
      name: `AP ${i}`,
      radios: [{ band: '2.4GHz' }, { band: '5GHz' }],
    })),
    region: 'US',
    ...extra,
  }
}

describe('accessPointLinks', () => {
  it('is free-space signal between access points in an open room', () => {
    const plan = home([
      [5, 5],
      [15, 5],
    ])
    const nodes = plan.accessPoints.map((a) => ({ ap: a, radio: a.radios[1]! }))
    const links = accessPointLinks(plan, '5GHz', nodes)
    expect(links[0]![1]).toBeCloseTo(freeSpaceDbm(10), 6)
    expect(links[1]![0]).toBeCloseTo(freeSpaceDbm(10), 6)
    expect(links[0]![0]).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('planBandChannels (D68)', () => {
  const three: [number, number][] = [
    [5, 5],
    [15, 10],
    [25, 15],
  ]

  it('narrows to 40 MHz without DFS, where 80 MHz has only two channels', () => {
    const result = planBandChannels(home(three), '5GHz')!
    expect(result.clashes).toBe(0)
    expect(result.autoWidthMHz).toBe(40)
    expect(result.usualWidthMHz).toBe(80)
    expect(new Set(result.radios.map((r) => r.channel)).size).toBe(3)
    expect(result.radios.every((r) => r.hears.length === 2)).toBe(true)
    // DFS would keep 80 MHz.
    expect(result.withDfs).toEqual({ clashes: 0, autoWidthMHz: 80 })
  })

  it('keeps 80 MHz with DFS allowed, using a DFS channel', () => {
    const result = planBandChannels(home(three, { allowDfs: true }), '5GHz')!
    expect(result.clashes).toBe(0)
    expect(result.autoWidthMHz).toBe(80)
    expect(result.radios.filter((r) => r.dfs)).toHaveLength(1)
    expect(result.withDfs).toBeUndefined()
    // Without DFS it would have had to narrow (D69).
    expect(result.withoutDfs).toEqual({
      clashes: 0,
      autoWidthMHz: 40,
      worse: 'width',
    })
  })

  it('says nothing about DFS when the plan uses none (D69)', () => {
    const two = home(three.slice(0, 2), { allowDfs: true })
    const result = planBandChannels(two, '5GHz')!
    expect(result.radios.some((r) => r.dfs)).toBe(false)
    expect(result.withoutDfs).toBeUndefined()
    expect(planBandChannels(home(three), '5GHz')!.withoutDfs).toBeUndefined()
  })

  it('says a hand-set width would clash without DFS (D69)', () => {
    const plan = home(three, { allowDfs: true })
    for (const ap of plan.accessPoints) ap.radios[1]!.channelWidthMHz = 80
    const result = planBandChannels(plan, '5GHz')!
    expect(result.clashes).toBe(0)
    expect(result.withoutDfs).toEqual({
      clashes: 1,
      autoWidthMHz: 80,
      worse: 'clashes',
    })
  })

  it('leaves a clash on 2.4 GHz for four access points in the US, not in the EU', () => {
    const four = home([...three, [25, 5]])
    const us = planBandChannels(four, '2.4GHz')!
    expect(us.clashes).toBe(1)
    expect(us.exact).toBe(true)
    const clashing = us.radios.filter((r) => r.clashesWith.length > 0)
    expect(clashing).toHaveLength(2)
    const eu = planBandChannels({ ...four, region: 'EU' }, '2.4GHz')!
    expect(eu.clashes).toBe(0)
  })

  it('keeps hand-set channels and widths', () => {
    const plan = home(three)
    plan.accessPoints[0]!.radios[1] = {
      band: '5GHz',
      channel: 155,
      channelWidthMHz: 80,
    }
    plan.accessPoints[1]!.radios[1] = { band: '5GHz', channelWidthMHz: 20 }
    const result = planBandChannels(plan, '5GHz')!
    const [a, b, d] = result.radios
    expect(a).toMatchObject({ channel: 155, widthMHz: 80, fixed: true })
    expect(b!.widthMHz).toBe(20)
    expect(b!.fixed).toBe(false)
    // The third takes 42 at 80 MHz (5170–5250). The 20 MHz one takes 165
    // (5815–5835), which only touches 155 at 80 MHz (5735–5815).
    expect(result.clashes).toBe(0)
    expect(d).toMatchObject({ channel: 42, widthMHz: 80 })
    expect(b!.channel).toBe(165)
  })

  it('treats access points too faint to hear each other as free to share', () => {
    const plan = home([
      [1, 1],
      [29, 19],
    ])
    // −10 dBm EIRP 34 m apart: about −91 dBm, below −82 at 20 MHz.
    for (const a of plan.accessPoints) {
      a.radios = [{ band: '5GHz', txPowerDbm: -10, channelWidthMHz: 20 }]
    }
    const result = planBandChannels(plan, '5GHz')!
    expect(result.radios.every((r) => r.hears.length === 0)).toBe(true)
    expect(result.clashes).toBe(0)
  })

  it('avoids a strong neighbour’s network', () => {
    const plan = home(three, {
      neighbourNetworks: [
        {
          id: 'n1',
          band: '5GHz',
          channel: 38,
          channelWidthMHz: 40,
          strengthDbm: -60,
        },
      ],
    })
    const result = planBandChannels(plan, '5GHz')!
    // At 40 MHz only 46, 151 and 159 are left for three: still clash-free.
    expect(result.clashes).toBe(0)
    expect(result.radios.map((r) => r.channel).sort()).toEqual([151, 159, 46])
    expect(result.radios[0]!.networks).toEqual([
      { id: 'n1', strong: true, overlaps: false },
    ])
  })

  it('plans every band with radios', () => {
    expect(planChannels(home(three)).map((p) => p.band)).toEqual([
      '2.4GHz',
      '5GHz',
    ])
    expect(planBandChannels(home(three), '6GHz')).toBeUndefined()
  })
})
