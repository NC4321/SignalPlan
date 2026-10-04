import { parsePlan, type Plan } from '@signalplan/floorplan'
import apartment from '@signalplan/floorplan/fixtures/apartment.json'
import lShapedHouse from '@signalplan/floorplan/fixtures/l-shaped-house.json'
import sampleHome from '@signalplan/floorplan/fixtures/sample-home.json'
import surveyedHome from '@signalplan/floorplan/fixtures/surveyed-home.json'
import threeApHome from '@signalplan/floorplan/fixtures/three-ap-home.json'
import twoStoreyHome from '@signalplan/floorplan/fixtures/two-storey-home.json'
import { describe, expect, it } from 'vitest'
import {
  isShareFragment,
  LONG_LINK,
  MAX_PLAN_BYTES,
  planFromFragment,
  shareLink,
} from './shareLink.ts'

const BASE = 'https://signalplan.pages.dev/'

const fixtures: Record<string, unknown> = {
  apartment,
  lShapedHouse,
  sampleHome,
  surveyedHome,
  threeApHome,
  twoStoreyHome,
}

function plan(raw: unknown): Plan {
  const result = parsePlan(raw)
  if (!result.ok) throw new Error(result.issues[0]?.message)
  return result.plan
}

describe('shareLink', () => {
  for (const [name, raw] of Object.entries(fixtures)) {
    it(`round-trips the ${name} fixture, well under the long-link warning`, async () => {
      const original = plan(raw)
      const { url, imagesLeftOut } = await shareLink(original, BASE)
      expect(url.startsWith(`${BASE}#plan=1.`)).toBe(true)
      expect(url.length).toBeLessThan(LONG_LINK / 4)
      expect(imagesLeftOut).toEqual([])
      const hash = new URL(url).hash
      expect(isShareFragment(hash)).toBe(true)
      expect(await planFromFragment(hash)).toEqual({
        ok: true,
        plan: original,
      })
    })
  }

  it('keeps the page’s path and query, replacing any fragment', async () => {
    const { url } = await shareLink(plan(apartment), `${BASE}app/?fps#old`)
    expect(url.startsWith(`${BASE}app/?fps#plan=1.`)).toBe(true)
  })

  it('leaves tracing images out, naming their floors', async () => {
    const original = plan(sampleHome)
    const traced: Plan = {
      ...original,
      floors: original.floors.map((floor) => ({
        ...floor,
        background: {
          imageId: 'img-1',
          x: 0,
          y: 0,
          metresPerPixel: 0.01,
          widthPx: 1000,
          heightPx: 800,
          opacity: 0.5,
          visible: true,
          locked: false,
        },
      })),
    }
    const { url, imagesLeftOut } = await shareLink(traced, BASE)
    expect(imagesLeftOut).toEqual(original.floors.map((f) => f.name))
    const result = await planFromFragment(new URL(url).hash)
    expect(result).toEqual({ ok: true, plan: original })
  })

  it('reports a link cut short', async () => {
    const { url } = await shareLink(plan(threeApHome), BASE)
    const hash = new URL(url).hash
    const result = await planFromFragment(hash.slice(0, hash.length / 2))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]!.message).toMatch(/incomplete/)
  })

  it('stops reading a link that inflates past any real plan', async () => {
    const stream = new Blob([' '.repeat(MAX_PLAN_BYTES + 1)])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'))
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    const data = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const result = await planFromFragment(`#plan=1.${data}`)
    expect(result.ok).toBe(false)
  })

  it('reports characters that base64url doesn’t use', async () => {
    const result = await planFromFragment('#plan=1.abc$def')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]!.message).toMatch(/incomplete/)
  })

  it('reports a newer link format, and one that isn’t a plan link', async () => {
    const newer = await planFromFragment('#plan=2.abc')
    expect(newer.ok).toBe(false)
    if (!newer.ok) expect(newer.issues[0]!.message).toMatch(/newer version/)
    for (const hash of ['#plan=', '#plan=x.abc', '#plan=abc']) {
      const result = await planFromFragment(hash)
      expect(result.ok, hash).toBe(false)
      if (!result.ok) expect(result.issues[0]!.message).toMatch(/isn’t/)
    }
  })

  it('validates the decoded plan as a file would be', async () => {
    const broken = { ...plan(apartment), floors: [] }
    const { url } = await shareLink(broken as Plan, BASE)
    const result = await planFromFragment(new URL(url).hash)
    expect(result.ok).toBe(false)
  })

  it('recognises only plan fragments', () => {
    expect(isShareFragment('#plan=1.abc')).toBe(true)
    expect(isShareFragment('')).toBe(false)
    expect(isShareFragment('#fps')).toBe(false)
  })
})
