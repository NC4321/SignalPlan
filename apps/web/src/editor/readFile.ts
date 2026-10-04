import type { PlanIssue } from '@signalplan/floorplan'

/** The largest file of each kind that's read into memory as text. */
export const MAX_PLAN_FILE_BYTES = 100_000_000
export const MAX_READINGS_FILE_BYTES = 10_000_000
export const MAX_SCAN_FILE_BYTES = 5_000_000

export type TextRead =
  { ok: true; text: string } | { ok: false; issues: PlanIssue[] }

const megabytes = (bytes: number) =>
  bytes >= 10_000_000
    ? `${Math.round(bytes / 1_000_000)} MB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`

/** Why a file is too big to read, and what to try. Empty if it's fine. */
export function tooBigMessage(size: number, max: number): string | undefined {
  return size > max
    ? `The file is ${megabytes(size)}, more than the ${megabytes(max)} that can be read here. Check it’s the right file.`
    : undefined
}

/** What to say when the browser couldn't read a file at all. */
export const UNREADABLE_FILE_MESSAGE =
  'The browser couldn’t read the file. It may have been moved or deleted, or be on a drive that’s no longer connected. Choose it again, or copy it somewhere local first.'

/** What to say when a file has nothing in it. */
export const EMPTY_FILE_MESSAGE = 'The file is empty. Choose another.'

/**
 * Reads a chosen file as text, or says why it can't be: too big, empty, or
 * the browser failed to read it. Nothing throws.
 */
export async function readTextFile(
  file: Pick<File, 'size' | 'text'>,
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
    const text = await file.text()
    return text.trim() === '' ? fail(EMPTY_FILE_MESSAGE) : { ok: true, text }
  } catch {
    return fail(UNREADABLE_FILE_MESSAGE)
  }
}
