import type {
  AccessPoint,
  Band,
  ChannelWidth,
  Plan,
  Radio,
} from '@signalplan/floorplan'
import { signalDbm } from './coverage.ts'
import { preparedWallLoss } from './crossings.ts'
import { crossingLossDb, floorCrossing, prepareStack } from './floors.ts'
import { radioTuning } from './interference.ts'
import {
  availableChannels,
  channelSpanMHz,
  channelWidths,
  regionBand,
} from './regions.ts'

/**
 * The channel planner (D61, D68): per band, access points that hear each
 * other get channels that don't overlap, where that's possible. It's graph
 * colouring: each radio is a node, and two are joined when either receives
 * the other at or above the 802.11 clear-channel-assessment (CCA) level for
 * the sender's width, walls and floors included.
 */

/**
 * The level at which a receiver must treat a channel as busy when a
 * transmission of this width starts in it, in dBm: IEEE Std 802.11ac-2013,
 * 22.3.19.5.3, Table 22-27 (−82 dBm at 20 MHz, as in 802.11a-1999,
 * 17.3.10.5). An access point that hears another at this level waits for it.
 */
export const CCA_DBM: Readonly<Record<ChannelWidth, number>> = {
  20: -82,
  40: -79,
  80: -76,
  160: -73,
}

/**
 * 2.4 GHz channels the planner suggests at 20 MHz (D68): the usual sets that
 * leave a gap between channels, since real transmitters leak past a
 * channel's edge. Hand-set channels outside them are kept.
 */
export const PLANNED_2G4_CHANNELS = {
  withChannel13: [1, 5, 9, 13],
  without: [1, 6, 11],
} as const

/** A channel the planner can give a radio. */
export interface Choice {
  channel: number
  widthMHz: ChannelWidth
  dfs: boolean
}

/** A neighbour's network as the planner sees it. */
export interface PlannerNetwork {
  id: string
  channel: number
  widthMHz: ChannelWidth
  /** Its power in the home, in mW. */
  mw: number
  /** At or above the CCA level for its width: a clash, like an AP's. */
  strong: boolean
}

/**
 * A channel-colouring problem on one band. `fixed` radios keep their channel;
 * the others choose from `candidates`. `heard[i][j]` joins radios i and j,
 * and `linkMw[i][j]` is j's power at i, for the tie-break on interference.
 */
export interface ColouringProblem {
  band: Band
  radios: readonly {
    fixed: Choice | undefined
    candidates: readonly Choice[]
  }[]
  heard: readonly (readonly boolean[])[]
  linkMw: readonly (readonly number[])[]
  networks: readonly PlannerNetwork[]
}

/**
 * What a plan costs, compared in order: same-channel clashes between radios
 * that hear each other (or a strong neighbour's network), the MHz those
 * clashes share, interference power in mW between every pair and from every
 * network, and how many chosen channels need DFS.
 */
export type PlanCost = readonly [number, number, number, number]

export interface ColouringResult {
  choices: Choice[]
  cost: PlanCost
  /** False when the search stopped at its node limit: best found, not proven. */
  exact: boolean
}

/** Overlap of two channels in MHz, 0 when they only touch or are apart. */
export function overlapMHz(
  band: Band,
  a: Pick<Choice, 'channel' | 'widthMHz'>,
  b: Pick<Choice, 'channel' | 'widthMHz'>,
): number {
  const [a0, a1] = channelSpanMHz(band, a.channel, a.widthMHz)
  const [b0, b1] = channelSpanMHz(band, b.channel, b.widthMHz)
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

const ZERO: PlanCost = [0, 0, 0, 0]

function add(a: PlanCost, b: PlanCost): PlanCost {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]]
}

/** Negative when a is the better plan, 0 when they tie. */
export function compareCost(a: PlanCost, b: PlanCost): number {
  for (let k = 0; k < 4; k++) {
    const x = a[k]!
    const y = b[k]!
    const tolerance = k === 2 ? 1e-9 * Math.max(Math.abs(x), Math.abs(y)) : 0
    if (Math.abs(x - y) > tolerance) return x - y
  }
  return 0
}

/**
 * Colours a problem exactly, by branch and bound: radios with the most
 * neighbours first, each channel tried from the cheapest, and a branch
 * dropped once even the cheapest channel for every radio still to go can't
 * beat the best plan found. Ties go to the first found, so the answer is
 * the same every time. Past `nodeLimit` choices it returns the best so far.
 */
export function colourChannels(
  problem: ColouringProblem,
  nodeLimit = 20_000,
): ColouringResult {
  const { band, radios, heard, linkMw, networks } = problem
  const n = radios.length

  const pair = (i: number, a: Choice, j: number, b: Choice): PlanCost => {
    const overlap = overlapMHz(band, a, b)
    if (overlap === 0) return ZERO
    const interference =
      (overlap / b.widthMHz) * linkMw[i]![j]! +
      (overlap / a.widthMHz) * linkMw[j]![i]!
    return heard[i]![j]!
      ? [1, overlap, interference, 0]
      : [0, 0, interference, 0]
  }
  const alone = (choice: Choice, planned: boolean): PlanCost => {
    let cost: PlanCost = [0, 0, 0, planned && choice.dfs ? 1 : 0]
    for (const net of networks) {
      const overlap = overlapMHz(band, choice, net)
      if (overlap === 0) continue
      const mw = (overlap / net.widthMHz) * net.mw
      cost = add(cost, net.strong ? [1, overlap, mw, 0] : [0, 0, mw, 0])
    }
    return cost
  }

  const choices: (Choice | undefined)[] = radios.map((r) => r.fixed)
  let base: PlanCost = ZERO
  for (let i = 0; i < n; i++) {
    const a = radios[i]!.fixed
    if (!a) continue
    base = add(base, alone(a, false))
    for (let j = i + 1; j < n; j++) {
      const b = radios[j]!.fixed
      if (b) base = add(base, pair(i, a, j, b))
    }
  }

  // Most-connected radios first, since they're hardest to fit.
  const degree = (i: number) => heard[i]!.filter(Boolean).length
  const order = radios
    .map((r, i) => ({ i, free: r.fixed === undefined }))
    .filter((r) => r.free)
    .map((r) => r.i)
    .sort((a, b) => degree(b) - degree(a) || a - b)

  // What giving radio i each candidate adds, given the choices made so far.
  const options = (i: number) =>
    radios[i]!.candidates.map((c) => {
      let cost = alone(c, true)
      for (let j = 0; j < n; j++) {
        const other = choices[j]
        if (j !== i && other) cost = add(cost, pair(i, c, j, other))
      }
      return { choice: c, cost }
    }).sort((a, b) => compareCost(a.cost, b.cost))

  // Channels no radio in the search is on yet, that meet everything else in
  // the problem the same way, are interchangeable: swapping them in any plan
  // gives a plan that costs the same. So only the first of each such group is
  // tried, which keeps the search exact (symmetry breaking).
  const key = (c: Choice) => `${c.channel}/${c.widthMHz}`
  const distinct = new Map<string, Choice>()
  for (const r of radios) {
    for (const c of r.candidates) distinct.set(key(c), c)
  }
  const fixedChoices = radios.flatMap((r) => (r.fixed ? [r.fixed] : []))
  // Swapping two channels only maps plans onto plans when channels of their
  // width never partly overlap each other, as on 5 and 6 GHz. On 2.4 GHz at
  // 40 MHz they do, so there each channel is its own group.
  const grid = new Map<ChannelWidth, boolean>()
  for (const a of distinct.values()) {
    for (const b of distinct.values()) {
      if (a !== b && a.widthMHz === b.widthMHz && overlapMHz(band, a, b) > 0) {
        grid.set(a.widthMHz, false)
      }
    }
  }
  const signature = new Map<string, string>()
  for (const [k, c] of distinct) {
    if (grid.get(c.widthMHz) === false) {
      signature.set(k, k)
      continue
    }
    signature.set(
      k,
      JSON.stringify([
        c.widthMHz,
        c.dfs,
        fixedChoices.map((f) => overlapMHz(band, c, f)),
        networks.map((net) => overlapMHz(band, c, net)),
        [...distinct.values()]
          .filter((o) => o.widthMHz !== c.widthMHz)
          .map((o) => overlapMHz(band, c, o)),
        radios.map((r) => r.candidates.some((o) => key(o) === k)),
      ]),
    )
  }
  const unused = (c: Choice) =>
    order.every((j) => {
      const other = choices[j]
      return !other || overlapMHz(band, c, other) === 0
    })

  let best: { choices: Choice[]; cost: PlanCost } | undefined
  let nodes = 0
  let exact = true

  const search = (k: number, cost: PlanCost) => {
    if (k === order.length) {
      if (!best || compareCost(cost, best.cost) < 0) {
        best = { choices: choices.map((c) => c!), cost }
      }
      return
    }
    const i = order[k]!
    const tried = new Set<string>()
    const mine = options(i).filter(({ choice }) => {
      if (!unused(choice)) return true
      const group = signature.get(key(choice))!
      if (tried.has(group)) return false
      tried.add(group)
      return true
    })
    // The cheapest each later radio could add, given only what's chosen now:
    // choices still to come only add cost, so this can't overestimate.
    let bound = cost
    for (let m = k + 1; m < order.length; m++) {
      const later = options(order[m]!)
      if (later.length > 0) bound = add(bound, later[0]!.cost)
    }
    for (const { choice, cost: extra } of mine) {
      if (best && compareCost(add(bound, extra), best.cost) >= 0) break
      if (++nodes > nodeLimit) {
        exact = false
        return
      }
      choices[i] = choice
      search(k + 1, add(cost, extra))
      choices[i] = undefined
      if (!exact) return
    }
  }
  search(0, base)

  if (!best) {
    // Stopped before any full plan: give each radio its cheapest channel in
    // turn instead.
    let cost = base
    for (const i of order) {
      const cheapest = options(i)[0]!
      choices[i] = cheapest.choice
      cost = add(cost, cheapest.cost)
    }
    return { choices: choices.map((c) => c!), cost, exact: false }
  }
  return { choices: best.choices, cost: best.cost, exact }
}

/** The channels the planner may give a radio of this width (D68). */
export function candidateChoices(
  region: Plan['region'],
  band: Band,
  widthMHz: ChannelWidth,
  allowDfs: boolean,
): Choice[] {
  let channels = availableChannels(region, band, widthMHz, allowDfs)
  if (band === '2.4GHz' && widthMHz === 20) {
    const listed = regionBand(region, band).channels[20] ?? []
    const preferred: readonly number[] = listed.includes(13)
      ? PLANNED_2G4_CHANNELS.withChannel13
      : PLANNED_2G4_CHANNELS.without
    channels = channels.filter((c) => preferred.includes(c.channel))
  }
  return channels.map((c) => ({
    channel: c.channel,
    widthMHz: c.width,
    dfs: c.dfs,
  }))
}

/** One radio's place in a band's channel plan. */
export interface PlannedRadio {
  accessPointId: string
  channel: number
  widthMHz: ChannelWidth
  dfs: boolean
  /** Set by hand, so kept. */
  fixed: boolean
  /** Its width was set by hand, so the planner didn't choose it. */
  widthFixed: boolean
  /** Access points it hears or is heard by, at the CCA level. */
  hears: string[]
  /** Those it shares spectrum with in this plan. */
  clashesWith: string[]
  /** The band's neighbours' networks with a channel, and how this one sits. */
  networks: { id: string; strong: boolean; overlaps: boolean }[]
}

export interface BandChannelPlan {
  band: Band
  radios: PlannedRadio[]
  /** Access points whose width no channel in the region fits. */
  skipped: string[]
  /** Same-channel clashes left, between neighbours or with strong networks. */
  clashes: number
  /** The width radios on Auto get, and the band's usual one (D66). */
  autoWidthMHz: ChannelWidth
  usualWidthMHz: ChannelWidth
  /** Whether any radio's width is on Auto, so the planner picks it. */
  choosesWidth: boolean
  /**
   * With DFS off on 5 GHz: what allowing it would give, when that's better,
   * fewer clashes or a wider width. Undefined otherwise.
   */
  withDfs: { clashes: number; autoWidthMHz: ChannelWidth } | undefined
  /**
   * With DFS on, when the planner gave radios DFS channels: what planning
   * without them would give, and the first way it's worse, in the order
   * plans are compared (D69). Undefined otherwise.
   */
  withoutDfs: WithoutDfs | undefined
  /** Whether the search was complete, so no better plan exists. */
  exact: boolean
}

export interface WithoutDfs {
  clashes: number
  autoWidthMHz: ChannelWidth
  worse: 'clashes' | 'width' | 'sharedMHz' | 'interference'
}

/** A band's plan, with its cost, before the DFS comparisons are added. */
type Attempt = Omit<BandChannelPlan, 'withDfs' | 'withoutDfs'> & {
  cost: PlanCost
}

interface Node {
  ap: AccessPoint
  radio: Radio
}

/**
 * Each radio's signal at every other access point's antenna, in dBm:
 * `link[i][j]` is j's signal at i, through walls and floors (D51), with the
 * receiver at the other access point's mounting height.
 */
export function accessPointLinks(
  plan: Plan,
  band: Band,
  nodes: readonly Node[],
): number[][] {
  const stack = prepareStack(plan, band)
  const storeyOf = new Map(stack.map((s, i) => [s.floor.id, i]))
  const place = nodes.map(({ ap }) => {
    const storey = storeyOf.get(ap.floorId)!
    return { storey, z: stack[storey]!.floor.elevationM + ap.heightM }
  })
  return nodes.map((to, i) =>
    nodes.map((from, j) => {
      if (i === j) return Number.NEGATIVE_INFINITY
      const a = place[j]!
      const b = place[i]!
      const loss =
        a.storey === b.storey
          ? preparedWallLoss(
              stack[a.storey]!.walls,
              from.ap.x,
              from.ap.y,
              to.ap.x,
              to.ap.y,
            )
          : crossingLossDb(
              floorCrossing(stack, a.storey, a.z, b.storey, b.z),
              from.ap.x,
              from.ap.y,
              to.ap.x,
              to.ap.y,
            )
      return signalDbm(from.ap, from.radio, to.ap.x, to.ap.y, loss, a.z - b.z)
    }),
  )
}

/**
 * Plans one band's channels (D68). Radios with a hand-set channel keep it.
 * The rest get the band's usual width, or, when no plan without clashes
 * exists there, the widest narrower one that has one; a hand-set width stays.
 * Undefined when no access point has a radio on the band.
 */
export function planBandChannels(
  plan: Plan,
  band: Band,
  nodeLimit?: number,
): BandChannelPlan | undefined {
  const nodes: Node[] = plan.accessPoints.flatMap((ap) => {
    const radio = ap.radios.find((r) => r.band === band)
    return radio ? [{ ap, radio }] : []
  })
  if (nodes.length === 0) return undefined
  const links = accessPointLinks(plan, band, nodes)
  const best = bestPlan(
    plan,
    band,
    nodes,
    links,
    plan.allowDfs ?? false,
    nodeLimit,
  )
  let withDfs: BandChannelPlan['withDfs']
  let withoutDfs: BandChannelPlan['withoutDfs']
  if (band === '5GHz' && !plan.allowDfs) {
    const dfs = bestPlan(plan, band, nodes, links, true, nodeLimit)
    const better =
      dfs.clashes < best.clashes ||
      (dfs.clashes === best.clashes && dfs.autoWidthMHz > best.autoWidthMHz)
    if (better) {
      withDfs = { clashes: dfs.clashes, autoWidthMHz: dfs.autoWidthMHz }
    }
  }
  if (
    band === '5GHz' &&
    plan.allowDfs &&
    best.radios.some((r) => r.dfs && !r.fixed)
  ) {
    const plain = bestPlan(plan, band, nodes, links, false, nodeLimit)
    const worse = plainIsWorse(best, plain)
    if (worse) {
      withoutDfs = {
        clashes: plain.clashes,
        autoWidthMHz: plain.autoWidthMHz,
        worse,
      }
    }
  }
  const { cost: _, ...result } = best
  return { ...result, withDfs, withoutDfs }
}

/**
 * How a plan without DFS channels falls short of one with them, in the order
 * plans are chosen: clashes, then width, then the cost's shared MHz and
 * interference. Undefined when it doesn't, as after a search that stopped
 * early.
 */
function plainIsWorse(
  dfs: Attempt,
  plain: Attempt,
): WithoutDfs['worse'] | undefined {
  if (plain.clashes !== dfs.clashes) {
    return plain.clashes > dfs.clashes ? 'clashes' : undefined
  }
  if (plain.autoWidthMHz !== dfs.autoWidthMHz) {
    return plain.autoWidthMHz < dfs.autoWidthMHz ? 'width' : undefined
  }
  const order = compareCost(
    [0, plain.cost[1], plain.cost[2], 0],
    [0, dfs.cost[1], dfs.cost[2], 0],
  )
  if (order <= 0) return undefined
  return plain.cost[1] > dfs.cost[1] ? 'sharedMHz' : 'interference'
}

function bestPlan(
  plan: Plan,
  band: Band,
  nodes: readonly Node[],
  links: readonly (readonly number[])[],
  allowDfs: boolean,
  nodeLimit: number | undefined,
): Attempt {
  const { region } = plan
  const usual = radioTuning({ band }, region).widthMHz
  const choosesWidth = nodes.some(
    ({ radio }) =>
      radio.channel === undefined && radio.channelWidthMHz === undefined,
  )
  // Widest first; only narrower than usual when that clears clashes.
  const widths = choosesWidth
    ? channelWidths(region, band)
        .filter((w) => w <= usual)
        .reverse()
    : [usual]
  let chosen: Attempt | undefined
  for (const width of widths) {
    const attempt = planAtWidth(
      plan,
      band,
      nodes,
      links,
      width,
      usual,
      choosesWidth,
      allowDfs,
      nodeLimit,
    )
    if (!chosen || attempt.clashes < chosen.clashes) chosen = attempt
    if (chosen.clashes === 0) break
  }
  return chosen!
}

function planAtWidth(
  plan: Plan,
  band: Band,
  nodes: readonly Node[],
  links: readonly (readonly number[])[],
  autoWidth: ChannelWidth,
  usual: ChannelWidth,
  choosesWidth: boolean,
  allowDfs: boolean,
  nodeLimit: number | undefined,
): Attempt {
  const { region } = plan
  const entries = nodes.map(({ ap, radio }) => {
    if (radio.channel !== undefined && radio.channelWidthMHz !== undefined) {
      const fixed: Choice = {
        channel: radio.channel,
        widthMHz: radio.channelWidthMHz,
        dfs: false,
      }
      return {
        ap,
        fixed,
        candidates: [] as Choice[],
        widthMHz: fixed.widthMHz,
        widthFixed: true,
      }
    }
    const widthMHz = radio.channelWidthMHz ?? autoWidth
    return {
      ap,
      fixed: undefined,
      candidates: candidateChoices(region, band, widthMHz, allowDfs),
      widthMHz,
      widthFixed: radio.channelWidthMHz !== undefined,
    }
  })
  // A radio whose width has no channel here can't be planned; leave it out.
  const kept = entries
    .map((e, i) => ({ ...e, i }))
    .filter((e) => e.fixed || e.candidates.length > 0)
  const skipped = entries
    .filter((e) => !e.fixed && e.candidates.length === 0)
    .map((e) => e.ap.id)

  const heard = kept.map((a) =>
    kept.map(
      (b) =>
        a !== b &&
        (links[a.i]![b.i]! >= CCA_DBM[b.widthMHz] ||
          links[b.i]![a.i]! >= CCA_DBM[a.widthMHz]),
    ),
  )
  const linkMw = kept.map((a) =>
    kept.map((b) => 10 ** (links[a.i]![b.i]! / 10)),
  )
  const networks: PlannerNetwork[] = (plan.neighbourNetworks ?? []).flatMap(
    (net) =>
      net.band === band && net.channel !== undefined
        ? [
            {
              id: net.id,
              channel: net.channel,
              widthMHz: net.channelWidthMHz,
              mw: 10 ** (net.strengthDbm / 10),
              strong: net.strengthDbm >= CCA_DBM[net.channelWidthMHz],
            },
          ]
        : [],
  )
  const result = colourChannels(
    {
      band,
      radios: kept.map((e) => ({ fixed: e.fixed, candidates: e.candidates })),
      heard,
      linkMw,
      networks,
    },
    nodeLimit,
  )
  const radios: PlannedRadio[] = kept.map((e, k) => {
    const choice = result.choices[k]!
    const hears = kept.filter((_, m) => heard[k]![m]).map((o) => o.ap.id)
    return {
      accessPointId: e.ap.id,
      channel: choice.channel,
      widthMHz: choice.widthMHz,
      dfs: availableChannels(region, band, choice.widthMHz, true).some(
        (c) => c.channel === choice.channel && c.dfs,
      ),
      fixed: e.fixed !== undefined,
      widthFixed: e.widthFixed,
      hears,
      clashesWith: kept
        .filter(
          (_, m) =>
            heard[k]![m] && overlapMHz(band, choice, result.choices[m]!) > 0,
        )
        .map((o) => o.ap.id),
      networks: networks.map((net) => ({
        id: net.id,
        strong: net.strong,
        overlaps: overlapMHz(band, choice, net) > 0,
      })),
    }
  })
  return {
    band,
    radios,
    skipped,
    clashes: result.cost[0],
    autoWidthMHz: autoWidth,
    usualWidthMHz: usual,
    choosesWidth,
    exact: result.exact,
    cost: result.cost,
  }
}

/** Every band's plan, for the bands any access point has a radio on. */
export function planChannels(
  plan: Plan,
  nodeLimit?: number,
): BandChannelPlan[] {
  return (['2.4GHz', '5GHz', '6GHz'] as const).flatMap((band) => {
    const planned = planBandChannels(plan, band, nodeLimit)
    return planned ? [planned] : []
  })
}
