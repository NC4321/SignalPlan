import {
  planChannels,
  type BandChannelPlan,
  type PlannedRadio,
} from '@signalplan/engine'
import { parsePlan, type Plan } from '@signalplan/floorplan'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import threeApHome from '@signalplan/floorplan/fixtures/three-ap-home.json'
import { describe, expect, it } from 'vitest'
import {
  bandSummary,
  channelLabel,
  channelPlanRecipe,
  listNames,
  radioReason,
  withChannelPlan,
} from './channelPlan.ts'
import { createEditorStore } from './store.ts'

function sample(): Plan {
  const result = parsePlan(sampleHome)
  if (!result.ok) throw new Error('fixture is invalid')
  return result.plan
}

/** The sample with a second access point beside the router. */
function twoAccessPoints(): Plan {
  const plan = sample()
  const router = plan.accessPoints[0]!
  plan.accessPoints.push({
    ...structuredClone(router),
    id: 'ap2',
    name: 'Office',
    x: router.x + 4,
  })
  return plan
}

const radio = (over: Partial<PlannedRadio>): PlannedRadio => ({
  accessPointId: 'a',
  channel: 36,
  widthMHz: 80,
  dfs: false,
  fixed: false,
  widthFixed: false,
  hears: [],
  clashesWith: [],
  networks: [],
  ...over,
})

const band = (over: Partial<BandChannelPlan>): BandChannelPlan => ({
  band: '5GHz',
  radios: [],
  skipped: [],
  clashes: 0,
  autoWidthMHz: 80,
  usualWidthMHz: 80,
  choosesWidth: true,
  withDfs: undefined,
  withoutDfs: undefined,
  exact: true,
  ...over,
})

const named: Plan = {
  ...sample(),
  accessPoints: ['a', 'b', 'c'].map((id, i) => ({
    ...sample().accessPoints[0]!,
    id,
    name: ['Router', 'Office', 'Loft'][i]!,
  })),
  neighbourNetworks: [
    {
      id: 'n1',
      name: 'Smith-5G',
      band: '5GHz',
      channel: 36,
      channelWidthMHz: 80,
      strengthDbm: -60,
    },
    {
      id: 'n2',
      band: '5GHz',
      channel: 149,
      channelWidthMHz: 20,
      strengthDbm: -90,
    },
  ],
}

describe('channel plan text (D68)', () => {
  it('lists names the way a sentence does', () => {
    expect(listNames(['A'])).toBe('A')
    expect(listNames(['A', 'B'])).toBe('A and B')
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C')
  })

  it('labels a channel with its centre, DFS and width', () => {
    expect(channelLabel('5GHz', radio({ channel: 58, dfs: true }))).toBe(
      '58 (5290 MHz, DFS) at 80 MHz',
    )
  })

  it('gives each radio a one-line reason', () => {
    // A width set by hand isn't the planner's narrowing.
    expect(
      radioReason(
        named,
        band({ autoWidthMHz: 20 }),
        radio({ widthMHz: 20, widthFixed: true }),
      ),
    ).toBe('Hears no other access point.')
    const b = band({})
    expect(radioReason(named, b, radio({ fixed: true }))).toBe(
      'Set by hand, so kept.',
    )
    expect(radioReason(named, b, radio({}))).toBe(
      'Hears no other access point.',
    )
    expect(radioReason(named, b, radio({ hears: ['b', 'c'] }))).toBe(
      'Apart from Office and Loft, which it hears.',
    )
    expect(
      radioReason(named, b, radio({ hears: ['b', 'c'], clashesWith: ['c'] })),
    ).toBe('Shares spectrum with Loft, which it hears; apart from Office.')
    expect(
      radioReason(
        named,
        band({ autoWidthMHz: 40 }),
        radio({
          widthMHz: 40,
          hears: ['b'],
          networks: [
            { id: 'n1', strong: true, overlaps: false },
            { id: 'n2', strong: false, overlaps: true },
          ],
        }),
      ),
    ).toBe(
      'Apart from Office, which it hears; clear of Smith-5G; overlaps the fainter Network 2; narrowed to 40 MHz.',
    )
  })

  it('sums up a band: clashes, narrowing, DFS and exactness', () => {
    expect(bandSummary(named, band({ clashes: 2 }))[0]).toBe(
      'No plan keeps them all apart on 5 GHz: 2 clashes are left, the fewest possible.',
    )
    expect(bandSummary(named, band({}))[0]).toBe(
      'No access point to plan on 5 GHz.',
    )
    expect(
      bandSummary(named, band({ radios: [radio({}), radio({})] })),
    ).toEqual([
      'No access point hears another on 5 GHz; channels are still spread to cut interference.',
    ])
    expect(
      bandSummary(
        named,
        band({ radios: [radio({ hears: ['b'] }), radio({ hears: ['a'] })] }),
      ),
    ).toEqual([
      'No access points that hear each other share a channel on 5 GHz.',
    ])
    expect(
      bandSummary(
        named,
        band({
          clashes: 1,
          autoWidthMHz: 20,
          withDfs: { clashes: 0, autoWidthMHz: 20 },
          exact: false,
          skipped: ['c'],
        }),
      ),
    ).toEqual([
      'No plan keeps them all apart on 5 GHz: 1 clash is left.',
      'Narrowed from 80 to 20 MHz, since there aren’t enough 80 MHz channels to keep them apart.',
      'Allowing DFS channels would clear these clashes.',
      'That’s the best plan found in the time allowed; a better one may exist.',
      'Loft has a width with no channels in this region, so isn’t planned.',
    ])
    expect(
      bandSummary(
        named,
        band({ autoWidthMHz: 40, withDfs: { clashes: 0, autoWidthMHz: 80 } }),
      )[2],
    ).toBe('Allowing DFS channels would keep 80 MHz.')
  })

  it('says why radios are on DFS channels (D69)', () => {
    const onDfs = [
      radio({ accessPointId: 'a' }),
      radio({ accessPointId: 'b', channel: 58, dfs: true }),
      radio({ accessPointId: 'c', channel: 106, dfs: true }),
    ]
    const why = (over: Partial<BandChannelPlan>) =>
      bandSummary(named, band({ radios: onDfs, ...over })).at(-1)
    expect(
      why({
        withoutDfs: { clashes: 1, autoWidthMHz: 80, worse: 'clashes' },
      }),
    ).toBe(
      'Office and Loft are on DFS channels: without DFS channels, 1 clash would be left.',
    )
    expect(
      why({
        clashes: 1,
        withoutDfs: { clashes: 3, autoWidthMHz: 80, worse: 'clashes' },
      }),
    ).toBe(
      'Office and Loft are on DFS channels: without DFS channels, 3 clashes would be left instead of 1.',
    )
    expect(
      why({ withoutDfs: { clashes: 0, autoWidthMHz: 40, worse: 'width' } }),
    ).toBe(
      'Office and Loft are on DFS channels: without DFS channels, the plan would narrow to 40 MHz.',
    )
    expect(
      why({
        withoutDfs: { clashes: 0, autoWidthMHz: 80, worse: 'interference' },
      }),
    ).toBe(
      'Office and Loft are on DFS channels: without DFS channels, there’d be more interference.',
    )
    // A DFS channel set by hand isn't the planner's choice.
    expect(
      bandSummary(
        named,
        band({
          radios: [onDfs[0]!, { ...onDfs[1]!, fixed: true }, onDfs[2]!],
          clashes: 1,
          withoutDfs: { clashes: 2, autoWidthMHz: 80, worse: 'clashes' },
        }),
      ).at(-1),
    ).toBe(
      'Loft is on a DFS channel: without DFS channels, 2 clashes would be left instead of 1.',
    )
  })
})

/**
 * Phase 6 exit gate (D69): on the three-AP home, the explanation names each
 * access point's channel and why: the ones it hears, the neighbour's network
 * it avoids, and DFS.
 */
describe('Phase 6 exit gate: the channel plan’s explanation (D69)', () => {
  function threeAp(width80: boolean, allowDfs: boolean): Plan {
    const result = parsePlan(threeApHome)
    if (!result.ok) throw new Error('fixture is invalid')
    const plan = result.plan
    return {
      ...plan,
      allowDfs,
      accessPoints: plan.accessPoints.map((ap) => ({
        ...ap,
        radios: ap.radios.map((r) =>
          width80 && r.band === '5GHz' ? { ...r, channelWidthMHz: 80 } : r,
        ),
      })),
    }
  }
  /** The 5 GHz summary, then "name: channel — reason" per access point. */
  function explain(plan: Plan) {
    const five = planChannels(plan).find((b) => b.band === '5GHz')!
    const name = (id: string) =>
      plan.accessPoints.find((ap) => ap.id === id)!.name
    return [
      ...bandSummary(plan, five),
      ...five.radios.map(
        (r) =>
          `${name(r.accessPointId)}: ${channelLabel('5GHz', r)} — ${radioReason(plan, five, r)}`,
      ),
    ]
  }

  it('explains a clash-free plan at 80 MHz with DFS', () => {
    expect(explain(threeAp(true, true))).toEqual([
      'No access points that hear each other share a channel on 5 GHz.',
      'Bedroom 2 mesh point and Upstairs mesh point are on DFS channels: without DFS channels, 1 clash would be left.',
      'Wi-Fi 6E router: 155 (5775 MHz) at 80 MHz — Apart from Bedroom 2 mesh point and Upstairs mesh point, which it hears; clear of Next door.',
      'Bedroom 2 mesh point: 58 (5290 MHz, DFS) at 80 MHz — Apart from Wi-Fi 6E router and Upstairs mesh point, which it hears; clear of Next door.',
      'Upstairs mesh point: 106 (5530 MHz, DFS) at 80 MHz — Apart from Wi-Fi 6E router and Bedroom 2 mesh point, which it hears; clear of Next door.',
    ])
  })

  it('explains the least-bad plan at 80 MHz without DFS', () => {
    expect(explain(threeAp(true, false))).toEqual([
      'No plan keeps them all apart on 5 GHz: 1 clash is left, the fewest possible.',
      'Allowing DFS channels would clear these clashes.',
      'Wi-Fi 6E router: 42 (5210 MHz) at 80 MHz — Apart from Bedroom 2 mesh point and Upstairs mesh point, which it hears; overlaps the fainter Next door.',
      'Bedroom 2 mesh point: 155 (5775 MHz) at 80 MHz — Shares spectrum with Upstairs mesh point, which it hears; apart from Wi-Fi 6E router; clear of Next door.',
      'Upstairs mesh point: 155 (5775 MHz) at 80 MHz — Shares spectrum with Bedroom 2 mesh point, which it hears; apart from Wi-Fi 6E router; clear of Next door.',
    ])
  })

  it('explains narrowing on Auto width without DFS', () => {
    expect(explain(threeAp(false, false)).slice(0, 3)).toEqual([
      'No access points that hear each other share a channel on 5 GHz.',
      'Narrowed from 80 to 40 MHz, since there aren’t enough 80 MHz channels to keep them apart.',
      'Allowing DFS channels would keep 80 MHz.',
    ])
  })
})

describe('applying a channel plan', () => {
  it('sets channel and width on planned radios, not hand-set ones', () => {
    const plan = twoAccessPoints()
    plan.accessPoints[1]!.radios = [
      { band: '5GHz', channel: 155, channelWidthMHz: 80 },
    ]
    const plans = [
      band({
        radios: [
          radio({ accessPointId: plan.accessPoints[0]!.id, channel: 42 }),
          radio({ accessPointId: 'ap2', channel: 999, fixed: true }),
        ],
      }),
    ]
    const next = withChannelPlan(plan, plans)
    expect(
      next.accessPoints[0]!.radios.find((r) => r.band === '5GHz'),
    ).toMatchObject({ channel: 42, channelWidthMHz: 80 })
    expect(next.accessPoints[1]!.radios[0]!.channel).toBe(155)
    // The plan itself is left as it was.
    expect(plan.accessPoints[0]!.radios.some((r) => r.channel)).toBe(false)
    const draft = structuredClone(plan)
    channelPlanRecipe(plans)(draft)
    expect(draft).toEqual(next)
  })

  it('suggests, applies as one undo step, and drops on any change', () => {
    const store = createEditorStore(twoAccessPoints())
    store.getState().planChannels()
    const suggestion = store.getState().channelPlan!
    expect(suggestion.map((b) => b.band)).toEqual(['2.4GHz', '5GHz', '6GHz'])
    // Four metres apart, the two hear each other on every band.
    for (const b of suggestion) {
      expect(b.clashes).toBe(0)
      expect(b.radios[0]!.hears).toEqual(['ap2'])
    }
    store.getState().applyChannelPlan()
    expect(store.getState().channelPlan).toBeUndefined()
    const radios = store.getState().plan.accessPoints.flatMap((ap) => ap.radios)
    expect(radios.every((r) => r.channel !== undefined)).toBe(true)
    expect(store.getState().past.at(-1)!.label).toBe('Apply the channel plan')
    store.getState().undo()
    expect(
      store
        .getState()
        .plan.accessPoints.flatMap((ap) => ap.radios)
        .some((r) => r.channel),
    ).toBe(false)

    store.getState().planChannels()
    store.getState().edit('Rename', (plan) => {
      plan.name = 'Renamed'
    })
    expect(store.getState().channelPlan).toBeUndefined()
    expect(store.getState().notice).toBe(
      'Channel plan dismissed: the plan changed.',
    )

    store.getState().planChannels()
    store.getState().dismissChannelPlan()
    expect(store.getState().channelPlan).toBeUndefined()
  })
})
