import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILE_MESSAGE,
  readTextFile,
  tooBigMessage,
  UNREADABLE_FILE_MESSAGE,
} from './readFile.ts'

const file = (text: string, size = text.length) => ({
  size,
  text: () => Promise.resolve(text),
})

describe('tooBigMessage', () => {
  it('is empty for a file within the limit', () => {
    expect(tooBigMessage(1000, 1000)).toBeUndefined()
  })

  it('says how big the file is and what the limit is', () => {
    expect(tooBigMessage(12_000_000, 10_000_000)).toBe(
      'The file is 12 MB, more than the 10 MB that can be read here. Check it’s the right file.',
    )
    expect(tooBigMessage(5_500_000, 5_000_000)).toContain('5.5 MB')
  })
})

describe('readTextFile', () => {
  it('returns the text of a readable file', async () => {
    expect(await readTextFile(file('{"a":1}'), 100)).toEqual({
      ok: true,
      text: '{"a":1}',
    })
  })

  it('refuses a file over the limit without reading it', async () => {
    let read = false
    const big = {
      size: 500,
      text: () => {
        read = true
        return Promise.resolve('x')
      },
    }
    const result = await readTextFile(big, 100)
    expect(result.ok).toBe(false)
    expect(read).toBe(false)
  })

  it('says an empty or blank file is empty', async () => {
    for (const empty of [file(''), file('  \n', 3)]) {
      expect(await readTextFile(empty, 100)).toEqual({
        ok: false,
        issues: [{ path: '', message: EMPTY_FILE_MESSAGE }],
      })
    }
  })

  it('says so when the browser fails to read the file', async () => {
    const failing = { size: 10, text: () => Promise.reject(new Error('x')) }
    expect(await readTextFile(failing, 100)).toEqual({
      ok: false,
      issues: [{ path: '', message: UNREADABLE_FILE_MESSAGE }],
    })
  })
})
