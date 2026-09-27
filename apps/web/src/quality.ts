/**
 * Signal quality bands for the heatmap. Colours are the viridis palette, which
 * stays distinguishable with common colour-vision deficiencies; brighter means
 * stronger. Below the weakest band a cell is left uncoloured.
 */
export interface QualityBand {
  label: string
  /** Lowest signal in the band, in dBm (inclusive). */
  minDbm: number
  /** What the level is good for, shown in the legend. */
  meaning: string
  rgb: readonly [number, number, number]
}

export const QUALITY_BANDS: readonly QualityBand[] = [
  {
    label: 'Excellent',
    minDbm: -50,
    meaning: 'Full speed',
    rgb: [0xfd, 0xe7, 0x25],
  },
  {
    label: 'Good',
    minDbm: -60,
    meaning: 'Fast and reliable',
    rgb: [0x5e, 0xc9, 0x62],
  },
  {
    label: 'Fair',
    minDbm: -67,
    meaning: 'Calls and streaming',
    rgb: [0x21, 0x91, 0x8c],
  },
  {
    label: 'Weak',
    minDbm: -75,
    meaning: 'Browsing and email',
    rgb: [0x3b, 0x52, 0x8b],
  },
  {
    label: 'Poor',
    minDbm: -85,
    meaning: 'Drops out',
    rgb: [0x44, 0x01, 0x54],
  },
]

/** The band a signal falls in, or undefined when it is below every band. */
export function qualityOf(dbm: number): QualityBand | undefined {
  return QUALITY_BANDS.find((band) => dbm >= band.minDbm)
}

export const cssColour = ({ rgb }: QualityBand) => `rgb(${rgb.join(' ')})`
