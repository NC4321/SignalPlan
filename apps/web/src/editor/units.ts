/** Display units (D4). Plans always store metres. */
export type Units = 'metric' | 'imperial'

const METRES_PER_INCH = 0.0254

/**
 * A length for display: metres to two decimals (3.45 m), or feet and inches
 * to the nearest half inch (12′ 6½″).
 */
export function formatLength(metres: number, units: Units): string {
  if (units === 'metric') return `${metres.toFixed(2)} m`

  const halfInches = Math.round((Math.abs(metres) / METRES_PER_INCH) * 2)
  const feet = Math.floor(halfInches / 24)
  const inches = (halfInches % 24) / 2
  const whole = Math.floor(inches)
  const inchText = `${whole}${inches % 1 ? '½' : ''}″`
  const sign = metres < 0 && halfInches > 0 ? '−' : ''
  return feet > 0 ? `${sign}${feet}′ ${inchText}` : `${sign}${inchText}`
}

const SQUARE_METRES_PER_SQUARE_FOOT = 0.09290304

/** An area for display, to the nearest whole unit: 148 m² or 1,593 sq ft. */
export function formatArea(squareMetres: number, units: Units): string {
  const value =
    units === 'metric'
      ? squareMetres
      : squareMetres / SQUARE_METRES_PER_SQUARE_FOOT
  const text = Math.round(value).toLocaleString('en-US')
  return units === 'metric' ? `${text} m²` : `${text} sq ft`
}

/** Grid snapping step: 10 cm, or 1 inch. */
export function snapStep(units: Units): number {
  return units === 'metric' ? 0.1 : METRES_PER_INCH
}

const NUMBER = String.raw`\d+(?:\.\d*)?|\.\d+`

const METRIC = new RegExp(String.raw`^(${NUMBER})\s*(mm|cm|m)?$`)
const IMPERIAL = new RegExp(
  String.raw`^(?:(${NUMBER})\s*')?\s*` + // feet
    String.raw`(?:(${NUMBER})?\s*(?:(\d+)\s*/\s*(\d+))?\s*")?$`, // inches, fraction
)

/**
 * Parses a typed length into metres, or undefined if it isn't one.
 *
 * Metric accepts `3.5`, `3.5 m`, `350 cm` and `3500 mm`. Imperial accepts
 * `12'6.5"`, `12' 6 1/2"`, `12.5'`, `150"`, `12 ft 6 in`, and a bare number
 * as feet. Either system also accepts the other's explicit units.
 */
export function parseLength(text: string, units: Units): number | undefined {
  const input = text
    .trim()
    .toLowerCase()
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/\s*(feet|foot|ft)\b/g, "'")
    .replace(/\s*(inches|inch|in)\b/g, '"')
  if (input === '') return undefined

  const bare = Number(input)
  if (Number.isFinite(bare) && /^[\d.]+$/.test(input)) {
    return units === 'metric' ? bare : bare * 12 * METRES_PER_INCH
  }

  const metric = METRIC.exec(input)
  if (metric) {
    const value = Number(metric[1])
    const factor = { mm: 0.001, cm: 0.01, m: 1 }[metric[2] as 'mm' | 'cm' | 'm']
    return value * factor
  }

  const imperial = IMPERIAL.exec(input)
  if (imperial && /['"]/.test(input)) {
    const [, feet, inches, numerator, denominator] = imperial
    if (denominator !== undefined && Number(denominator) === 0) return undefined
    if (
      input.includes('"') &&
      inches === undefined &&
      numerator === undefined
    ) {
      return undefined
    }
    const total =
      Number(feet ?? 0) * 12 +
      Number(inches ?? 0) +
      (numerator === undefined ? 0 : Number(numerator) / Number(denominator))
    return total * METRES_PER_INCH
  }

  return undefined
}

/**
 * As `parseLength`, but a leading minus sign makes it negative, as for the
 * elevation of a basement (D52).
 */
export function parseSignedLength(
  text: string,
  units: Units,
): number | undefined {
  const match = /^\s*[-−]\s*(.*)$/.exec(text)
  if (!match) return parseLength(text, units)
  const value = parseLength(match[1]!, units)
  return value === undefined ? undefined : -value
}
