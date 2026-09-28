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
 * first language that names a country decides; a country outside the US and
 * EU, such as en-GB, or no country at all falls back to the US.
 */
export function guessRegion(
  languages: readonly string[] = browserLanguages(),
): Region {
  for (const tag of languages) {
    let country: string | undefined
    try {
      country = new Intl.Locale(tag).region
    } catch {
      continue
    }
    if (country === undefined) continue
    return EU_COUNTRIES.has(country) ? 'EU' : DEFAULT_REGION
  }
  return DEFAULT_REGION
}

function browserLanguages(): readonly string[] {
  return globalThis.navigator?.languages ?? []
}

/** A region as it reads after "in": "in the US", "in the EU". */
export function regionPlace(region: Region | undefined): string {
  return (region ?? DEFAULT_REGION) === 'EU' ? 'the EU' : 'the US'
}
