import type { PlanIssue } from '@signalplan/floorplan'

/**
 * The largest file of each kind that's read into memory as text. A plan
 * carries each tracing image as base64, up to about 35 MB a floor, so the
 * plan limit is far above any file SignalPlan saves itself.
 */
export const MAX_PLAN_FILE_BYTES = 500_000_000
export const MAX_READINGS_FILE_BYTES = 10_000_000
export const MAX_SCAN_FILE_BYTES = 5_000_000

export type TextRead =
  { ok: true; text: string } | { ok: false; issues: PlanIssue[] }

/** A size rounded up, so a file over a limit never reads as equal to it. */
const sizeLabel = (bytes: number) =>
  bytes < 10_000_000
    ? `${(Math.ceil(bytes / 100_000) / 10).toFixed(1)} MB`
    : `${Math.ceil(bytes / 1_000_000)} MB`

/** Why a file is too big to read, and what to try. Empty if it's fine. */
export function tooBigMessage(size: number, max: number): string | undefined {
  return size > max
    ? `The file is ${sizeLabel(size)}, more than the ${Math.round(max / 1_000_000)} MB that can be read here. Check it’s the right file.`
    : undefined
}

/** What to say when the browser couldn't read a file at all. */
export const UNREADABLE_FILE_MESSAGE =
  'The browser couldn’t read the file. Choose it again, or copy it somewhere local first.'

/** What to say when a file has nothing in it. */
export const EMPTY_FILE_MESSAGE = 'The file is empty. Choose another.'

/**
 * Text from a file's bytes: UTF-8, or UTF-16 little-endian when it starts
 * with that byte order mark, which is what PowerShell 5's `>` writes.
 */
export function decodeText(bytes: ArrayBuffer): string {
  const head = new Uint8Array(bytes.slice(0, 2))
  const utf16 = head[0] === 0xff && head[1] === 0xfe
  return new TextDecoder(utf16 ? 'utf-16le' : 'utf-8').decode(bytes)
}

/**
 * Reads a chosen file as text, or says why it can't be: too big, empty, or
 * the browser failed to read it. Nothing throws.
 */
export async function readTextFile(
  file: Pick<File, 'size' | 'arrayBuffer'>,
  maxBytes: number,
): Promise<TextRead> {
  const fail = (message: string): TextRead => ({
    ok: false,
    issues: [{ path: '', message }],
  })
  const tooBig = tooBigMessage(file.size, maxBytes)
  if (tooBig) return fail(tooBig)
  if (file.size === 0) return fail(EMPTY_FILE_MESSAGE)
  try {
    const text = decodeText(await file.arrayBuffer())
    return text.trim() === '' ? fail(EMPTY_FILE_MESSAGE) : { ok: true, text }
  } catch {
    return fail(UNREADABLE_FILE_MESSAGE)
  }
}
