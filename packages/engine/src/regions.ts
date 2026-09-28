import {
  CHANNEL_WIDTHS,
  DEFAULT_REGION,
  type Band,
  type ChannelWidth,
  type Radio,
  type Region,
} from '@signalplan/floorplan'
import data from './regions.json'

/**
 * Channels and power limits per region and band (D61, D62), read from
 * `regions.json` so a region can be added or a rule changed without touching
 * code. Sources are in docs/MODEL.md, under Channels and regions.
 */

export { CHANNEL_WIDTHS, type ChannelWidth }

export interface RegionBand {
  /** Frequency ranges channels may occupy, in MHz. */
  rangesMHz: readonly (readonly [number, number])[]
  /** Ranges where radar detection (DFS) is required, in MHz. */
  dfsRangesMHz: readonly (readonly [number, number])[]
  /** Channel numbers allowed at each width, lowest first. */
  channels: Partial<Record<ChannelWidth, readonly number[]>>
  /** The highest EIRP allowed anywhere in the band, in dBm. */
  maxEirpDbm: number
  /** Where `maxEirpDbm` comes from, for the editor's note. */
  eirpNote: string
}

export interface RegionRules {
  name: string
  bands: Readonly<Record<Band, RegionBand>>
}

export interface Channel {
  channel: number
  width: ChannelWidth
  centreMHz: number
  /** Whether any part of the channel needs radar detection. */
  dfs: boolean
}

/** The data file's date, shown in MODEL.md when it changes. */
export const REGIONS_VERSION: string = data.version

export const REGION_RULES = data.regions as unknown as Readonly<
  Record<Region, RegionRules>
>

/** IEEE 802.11 channel starting frequencies: centre = start + 5 × channel. */
const START_MHZ: Readonly<Record<Band, number>> = {
  '2.4GHz': 2407,
  '5GHz': 5000,
  '6GHz': 5950,
}

export function channelCentreMHz(band: Band, channel: number): number {
  return START_MHZ[band] + 5 * channel
}

/** The frequencies a channel occupies, in MHz. */
export function channelSpanMHz(
  band: Band,
  channel: number,
  width: ChannelWidth,
): [number, number] {
  const centre = channelCentreMHz(band, channel)
  return [centre - width / 2, centre + width / 2]
}

export function regionBand(region: Region | undefined, band: Band): RegionBand {
  return REGION_RULES[region ?? DEFAULT_REGION].bands[band]
}

/** Widths the region allows on a band, narrowest first. */
export function channelWidths(
  region: Region | undefined,
  band: Band,
): ChannelWidth[] {
  const channels = regionBand(region, band).channels
  return CHANNEL_WIDTHS.filter((w) => (channels[w]?.length ?? 0) > 0)
}

/**
 * The channels a plan may use on a band at a width. DFS channels are left out
 * unless `allowDfs` is set.
 */
export function availableChannels(
  region: Region | undefined,
  band: Band,
  width: ChannelWidth,
  allowDfs = false,
): Channel[] {
  const rules = regionBand(region, band)
  const result: Channel[] = []
  for (const channel of rules.channels[width] ?? []) {
    const [low, high] = channelSpanMHz(band, channel, width)
    const dfs = rules.dfsRangesMHz.some(([a, b]) => low < b && high > a)
    if (dfs && !allowDfs) continue
    result.push({
      channel,
      width,
      centreMHz: channelCentreMHz(band, channel),
      dfs,
    })
  }
  return result
}

/**
 * Why a radio's hand-set width or channel isn't allowed by the plan's rules:
 * `region` when the region doesn't have it at all, `dfs` when it's a DFS
 * channel and DFS is off. Undefined when it's allowed or left to the planner.
 * The editor flags these rather than changing them (D63).
 */
export type ChannelIssue = 'region' | 'dfs'

export function radioChannelIssue(
  region: Region | undefined,
  allowDfs: boolean | undefined,
  radio: Radio,
): ChannelIssue | undefined {
  const width = radio.channelWidthMHz
  if (width === undefined) return undefined
  if (!channelWidths(region, radio.band).includes(width)) return 'region'
  if (radio.channel === undefined) return undefined
  const all = availableChannels(region, radio.band, width, true)
  const found = all.find((c) => c.channel === radio.channel)
  if (!found) return 'region'
  return found.dfs && allowDfs !== true ? 'dfs' : undefined
}
