import {
  channelCentreMHz,
  type BandChannelPlan,
  type PlannedRadio,
} from '@signalplan/engine'
import type { Plan } from '@signalplan/floorplan'
import { produce, type Draft } from 'immer'
import { BAND_LABELS } from './coverageText.ts'

/**
 * The channel planner's suggestion in the editor (D68): what Apply does, the
 * plan the map previews, and the words the panel shows.
 */

/** Sets every planned radio's channel and width; hand-set ones already are. */
export function channelPlanRecipe(plans: readonly BandChannelPlan[]) {
  return (plan: Draft<Plan>) => {
    for (const { band, radios } of plans) {
      for (const planned of radios) {
        if (planned.fixed) continue
        const radio = plan.accessPoints
          .find((ap) => ap.id === planned.accessPointId)
          ?.radios.find((r) => r.band === band)
        if (!radio) continue
        radio.channelWidthMHz = planned.widthMHz
        radio.channel = planned.channel
      }
    }
  }
}

/** The plan as it would be after Apply, for the map's preview. */
export function withChannelPlan(
  plan: Plan,
  plans: readonly BandChannelPlan[],
): Plan {
  return produce(plan, channelPlanRecipe(plans))
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

function names(plan: Plan) {
  const accessPoint = (id: string) =>
    plan.accessPoints.find((ap) => ap.id === id)?.name ?? id
  const networks = plan.neighbourNetworks ?? []
  const network = (id: string) => {
    const i = networks.findIndex((n) => n.id === id)
    return networks[i]?.name ?? `Network ${i + 1}`
  }
  return { accessPoint, network }
}

/** "36 (5180 MHz) at 80 MHz", with ", DFS" when it needs radar detection. */
export function channelLabel(band: BandChannelPlan['band'], r: PlannedRadio) {
  const centre = channelCentreMHz(band, r.channel)
  return `${r.channel} (${centre} MHz${r.dfs ? ', DFS' : ''}) at ${r.widthMHz} MHz`
}

/** Why a radio got its channel, in one line (D68). */
export function radioReason(
  plan: Plan,
  band: BandChannelPlan,
  r: PlannedRadio,
): string {
  const { accessPoint, network } = names(plan)
  if (r.fixed) return 'Set by hand, so kept.'
  const parts: string[] = []
  const clear = r.hears.filter((id) => !r.clashesWith.includes(id))
  if (r.hears.length === 0) {
    parts.push('Hears no other access point')
  } else if (r.clashesWith.length === 0) {
    parts.push(
      `Apart from ${listNames(clear.map(accessPoint))}, which it hears`,
    )
  } else {
    parts.push(
      `Shares spectrum with ${listNames(r.clashesWith.map(accessPoint))}, which it hears`,
    )
    if (clear.length > 0) {
      parts.push(`apart from ${listNames(clear.map(accessPoint))}`)
    }
  }
  const strongShared = r.networks.filter((n) => n.strong && n.overlaps)
  const weakShared = r.networks.filter((n) => !n.strong && n.overlaps)
  const avoided = r.networks.filter((n) => !n.overlaps)
  if (strongShared.length > 0) {
    parts.push(
      `shares with ${listNames(strongShared.map((n) => network(n.id)))}`,
    )
  }
  if (avoided.length > 0) {
    parts.push(`clear of ${listNames(avoided.map((n) => network(n.id)))}`)
  }
  if (weakShared.length > 0) {
    parts.push(
      `overlaps the fainter ${listNames(weakShared.map((n) => network(n.id)))}`,
    )
  }
  if (!r.widthFixed && r.widthMHz < band.usualWidthMHz) {
    parts.push(`narrowed to ${r.widthMHz} MHz`)
  }
  return `${parts.join('; ')}.`
}

/** The lines above a band's list: clashes, width, DFS, and exactness. */
export function bandSummary(plan: Plan, band: BandChannelPlan): string[] {
  const { accessPoint } = names(plan)
  const lines: string[] = []
  const label = BAND_LABELS[band.band]
  if (band.clashes === 0) {
    lines.push(
      band.radios.length === 0
        ? `No access point to plan on ${label}.`
        : band.radios.length === 1
          ? `One access point on ${label}.`
          : band.radios.every((r) => r.hears.length === 0)
            ? `No access point hears another on ${label}; channels are still spread to cut interference.`
            : `No access points that hear each other share a channel on ${label}.`,
    )
  } else {
    lines.push(
      `No plan keeps them all apart on ${label}: ${
        band.clashes === 1 ? '1 clash is' : `${band.clashes} clashes are`
      } left${band.exact ? ', the fewest possible' : ''}.`,
    )
  }
  if (band.choosesWidth && band.autoWidthMHz < band.usualWidthMHz) {
    lines.push(
      `Narrowed from ${band.usualWidthMHz} to ${band.autoWidthMHz} MHz, since there aren’t enough ${band.usualWidthMHz} MHz channels to keep them apart.`,
    )
  }
  if (band.withDfs) {
    const { clashes, autoWidthMHz } = band.withDfs
    lines.push(
      clashes < band.clashes
        ? clashes === 0
          ? 'Allowing DFS channels would clear these clashes.'
          : `Allowing DFS channels would leave ${clashes} instead.`
        : `Allowing DFS channels would keep ${autoWidthMHz} MHz.`,
    )
  }
  if (band.withoutDfs) {
    const onDfs = band.radios
      .filter((r) => r.dfs && !r.fixed)
      .map((r) => accessPoint(r.accessPointId))
    const { clashes, autoWidthMHz, worse } = band.withoutDfs
    const clashCount = clashes === 1 ? '1 clash' : `${clashes} clashes`
    const without = {
      clashes:
        band.clashes === 0
          ? `${clashCount} would be left`
          : `${clashCount} would be left instead of ${band.clashes}`,
      width: `the plan would narrow to ${autoWidthMHz} MHz`,
      sharedMHz: 'the access points that clash would share more spectrum',
      interference: 'there’d be more interference',
    }[worse]
    lines.push(
      `${listNames(onDfs)} ${onDfs.length === 1 ? 'is on a DFS channel' : 'are on DFS channels'}: without DFS channels, ${without}.`,
    )
  }
  if (!band.exact) {
    lines.push(
      'That’s the best plan found in the time allowed; a better one may exist.',
    )
  }
  if (band.skipped.length > 0) {
    lines.push(
      `${listNames(band.skipped.map(accessPoint))} ${
        band.skipped.length === 1 ? 'has' : 'have'
      } a width with no channels in this region, so ${
        band.skipped.length === 1 ? 'isn’t' : 'aren’t'
      } planned.`,
    )
  }
  return lines
}
