import { loadPlan, type ParseResult, type Plan } from '@signalplan/floorplan'

/**
 * Plans shared as links (D88): the plan's JSON, compressed with deflate and
 * base64url-encoded, in the link's fragment, `#plan=1.<data>`. A fragment
 * never reaches the server, so nothing leaves the browser until the link is
 * pasted somewhere. The `1.` is the link format's own version, separate from
 * the plan's `schemaVersion`, so the encoding can change later.
 */
export const LINK_PREFIX = '#plan='
const LINK_VERSION = '1'

/** Links longer than this may be cut off by the apps they're pasted into. */
export const LONG_LINK = 16_000

export interface ShareLink {
  url: string
  /** Names of the floors whose tracing image was left out. */
  imagesLeftOut: string[]
}

/** A link that opens a copy of the plan, without its tracing images. */
export async function shareLink(plan: Plan, base: string): Promise<ShareLink> {
  const imagesLeftOut = plan.floors
    .filter((floor) => floor.background)
    .map((floor) => floor.name)
  const shared: Plan = {
    ...plan,
    floors: plan.floors.map((floor) => {
      const copy = { ...floor }
      delete copy.background
      return copy
    }),
  }
  const data = await compress(JSON.stringify(shared))
  const url = new URL(base)
  url.hash = `${LINK_PREFIX.slice(1)}${LINK_VERSION}.${data}`
  return { url: url.href, imagesLeftOut }
}

/** Whether a location's fragment holds a shared plan. */
export function isShareFragment(hash: string): boolean {
  return hash.startsWith(LINK_PREFIX)
}

/** The plan in a link's fragment, validated as a file would be. */
export async function planFromFragment(hash: string): Promise<ParseResult> {
  const body = hash.slice(LINK_PREFIX.length)
  const dot = body.indexOf('.')
  const version = body.slice(0, dot)
  if (dot === -1 || version !== LINK_VERSION) {
    return unreadable(
      /^\d+$/.test(version) && Number(version) > Number(LINK_VERSION)
        ? 'The link was made by a newer version of SignalPlan.'
        : 'The link isn’t a SignalPlan plan link.',
    )
  }
  let json: string
  try {
    json = await decompress(body.slice(dot + 1))
  } catch {
    return unreadable('The link is incomplete or damaged: copy all of it.')
  }
  return loadPlan(json)
}

function unreadable(message: string): ParseResult {
  return { ok: false, issues: [{ path: '', message }] }
}

async function compress(text: string): Promise<string> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return toBase64Url(bytes)
}

/** Far more than any plan without images; stops a crafted link's flood. */
export const MAX_PLAN_BYTES = 20_000_000

async function decompress(data: string): Promise<string> {
  const reader = new Blob([fromBase64Url(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > MAX_PLAN_BYTES) {
      await reader.cancel()
      throw new Error('Too large')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(data: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(data)) throw new Error('Not base64url')
  const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

/**
 * Takes the plan out of the address bar once it's open, so reloading
 * doesn't open the link's plan again over your edits to it.
 */
export function clearShareFragment(location: Location, history: History) {
  history.replaceState(history.state, '', location.pathname + location.search)
}
