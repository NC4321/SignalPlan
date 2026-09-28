import { BANDS, REGIONS } from '@signalplan/floorplan'
import { describe, expect, it } from 'vitest'
import { BAND_PROFILES } from './bands.ts'
import {
  availableChannels,
  CHANNEL_WIDTHS,
  channelCentreMHz,
  channelSpanMHz,
  channelWidths,
  REGION_RULES,
  regionBand,
} from './regions.ts'

const numbers = (list: { channel: number }[]) => list.map((c) => c.channel)

describe('channel numbering', () => {
  it('puts centres on the IEEE 802.11 grid', () => {
    expect(channelCentreMHz('2.4GHz', 1)).toBe(2412)
    expect(channelCentreMHz('2.4GHz', 13)).toBe(2472)
    expect(channelCentreMHz('5GHz', 36)).toBe(5180)
    expect(channelCentreMHz('5GHz', 165)).toBe(5825)
    expect(channelCentreMHz('6GHz', 1)).toBe(5955)
    expect(channelCentreMHz('6GHz', 233)).toBe(7115)
  })

  it('spans half the width either side of the centre', () => {
    expect(channelSpanMHz('5GHz', 42, 80)).toEqual([5170, 5250])
    expect(channelSpanMHz('5GHz', 138, 80)).toEqual([5650, 5730])
    expect(channelSpanMHz('6GHz', 207, 160)).toEqual([6905, 7065])
  })
})

describe('region data', () => {
  it('covers every region and band', () => {
    expect(Object.keys(REGION_RULES).sort()).toEqual([...REGIONS].sort())
    for (const region of REGIONS) {
      for (const band of BANDS) {
        expect(channelWidths(region, band)).toContain(20)
      }
    }
  })

  it('keeps every channel inside the region’s ranges', () => {
    for (const region of REGIONS) {
      for (const band of BANDS) {
        const rules = regionBand(region, band)
        for (const width of CHANNEL_WIDTHS) {
          for (const channel of rules.channels[width] ?? []) {
            const [low, high] = channelSpanMHz(band, channel, width)
            const inside = rules.rangesMHz.some(
              ([a, b]) => low >= a && high <= b,
            )
            expect(inside, `${region} ${band} ${width} MHz ch ${channel}`).toBe(
              true,
            )
          }
        }
      }
    }
  })

  it('keeps default power within every region’s limit', () => {
    for (const region of REGIONS) {
      for (const band of BANDS) {
        expect(BAND_PROFILES[band].defaultTxPowerDbm).toBeLessThanOrEqual(
          regionBand(region, band).maxEirpDbm,
        )
      }
    }
  })

  it('has the FCC and ETSI power limits', () => {
    // FCC §§ 15.247, 15.407: 1 W + 6 dBi, and 30 dBm for indoor 6 GHz.
    expect(regionBand('US', '2.4GHz').maxEirpDbm).toBe(36)
    expect(regionBand('US', '5GHz').maxEirpDbm).toBe(36)
    expect(regionBand('US', '6GHz').maxEirpDbm).toBe(30)
    // EN 300 328, EN 301 893 (sub-band 3 with TPC), EN 303 687 (LPI).
    expect(regionBand('EU', '2.4GHz').maxEirpDbm).toBe(20)
    expect(regionBand('EU', '5GHz').maxEirpDbm).toBe(30)
    expect(regionBand('EU', '6GHz').maxEirpDbm).toBe(23)
  })

  it('treats a missing region as the US', () => {
    expect(regionBand(undefined, '5GHz')).toBe(regionBand('US', '5GHz'))
  })
})

describe('available channels', () => {
  it('leaves DFS channels out unless allowed', () => {
    expect(numbers(availableChannels('US', '5GHz', 80))).toEqual([42, 155])
    expect(numbers(availableChannels('US', '5GHz', 80, true))).toEqual([
      42, 58, 106, 122, 138, 155,
    ])
    expect(numbers(availableChannels('EU', '5GHz', 80))).toEqual([42])
  })

  it('counts a channel that only touches a DFS range as not DFS', () => {
    // Channel 48 ends at 5250 MHz, where the DFS range starts.
    const ch48 = availableChannels('US', '5GHz', 20, true).find(
      (c) => c.channel === 48,
    )
    expect(ch48?.dfs).toBe(false)
    const ch52 = availableChannels('US', '5GHz', 20, true).find(
      (c) => c.channel === 52,
    )
    expect(ch52?.dfs).toBe(true)
  })

  it('marks a channel that straddles a DFS edge as DFS', () => {
    // US channel 144 spans 5710–5730 MHz, across the 5725 MHz edge.
    const ch144 = availableChannels('US', '5GHz', 20, true).find(
      (c) => c.channel === 144,
    )
    expect(ch144?.dfs).toBe(true)
  })

  it('has no DFS on 2.4 or 6 GHz', () => {
    for (const region of REGIONS) {
      for (const band of ['2.4GHz', '6GHz'] as const) {
        for (const width of channelWidths(region, band)) {
          expect(availableChannels(region, band, width, true)).toEqual(
            availableChannels(region, band, width),
          )
        }
      }
    }
  })

  it('offers 20–160 MHz on 5 and 6 GHz, and 20–40 MHz on 2.4 GHz', () => {
    expect(channelWidths('US', '6GHz')).toEqual([20, 40, 80, 160])
    expect(channelWidths('US', '5GHz')).toEqual([20, 40, 80, 160])
    expect(channelWidths('EU', '2.4GHz')).toEqual([20, 40])
  })

  it('counts the 6 GHz channels per width', () => {
    const count = (region: 'US' | 'EU') =>
      CHANNEL_WIDTHS.map((w) => availableChannels(region, '6GHz', w).length)
    expect(count('US')).toEqual([59, 29, 14, 7])
    expect(count('EU')).toEqual([24, 12, 6, 3])
  })
})
