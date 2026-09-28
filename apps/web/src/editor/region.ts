import { DEFAULT_REGION, type Region } from '@signalplan/floorplan'

/** EU member states, by ISO 3166-1 country code. */
const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
])

/**
 * A new plan's region, guessed from the browser's languages (D61, D62). The
 * first valid language decides, with its most likely country when it names
 * none (`de` is Germany): an EU country gives EU, anything else, such as en-GB,
 * the US.
 */
export function guessRegion(
  languages: readonly string[] = browserLanguages(),
): Region {
  for (const tag of languages) {
    let country: string | undefined
    try {
      country = new Intl.Locale(tag).maximize().region
    } catch {
      continue
    }
    return country !== undefined && EU_COUNTRIES.has(country)
      ? 'EU'
      : DEFAULT_REGION
  }
  return DEFAULT_REGION
}

function browserLanguages(): readonly string[] {
  return globalThis.navigator?.languages ?? []
}

const PLACES: Record<Region, string> = { US: 'the US', EU: 'the EU' }

/** A region as it reads after "in": "in the US", "in the EU". */
export function regionPlace(region: Region | undefined): string {
  return PLACES[region ?? DEFAULT_REGION]
}
