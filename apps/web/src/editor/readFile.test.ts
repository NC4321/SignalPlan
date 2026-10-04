import { describe, expect, it } from 'vitest'
import {
  decodeText,
  EMPTY_FILE_MESSAGE,
  readTextFile,
  tooBigMessage,
  UNREADABLE_FILE_MESSAGE,
} from './readFile.ts'

const bytes = (text: string) => new TextEncoder().encode(text)
const file = (data: Uint8Array, size = data.length) => ({
  size,
  arrayBuffer: () => Promise.resolve(data.buffer as ArrayBuffer),
})
const textFile = (text: string) => file(bytes(text))

describe('tooBigMessage', () => {
  it('is empty for a file at or within the limit', () => {
    expect(tooBigMessage(1000, 1000)).toBeUndefined()
    expect(tooBigMessage(5_000_000, 5_000_000)).toBeUndefined()
  })

  it('says how big the file is and what the limit is', () => {
    expect(tooBigMessage(12_000_000, 10_000_000)).toBe(
      'The file is 12 MB, more than the 10 MB that can be read here. Check it’s the right file.',
    )
  })

  it('never reads as equal to the limit when one byte over', () => {
    expect(tooBigMessage(5_000_001, 5_000_000)).toContain(
      'The file is 5.1 MB, more than the 5 MB',
    )
    expect(tooBigMessage(10_000_001, 10_000_000)).toContain(
      'The file is 11 MB, more than the 10 MB',
    )
  })
})

describe('decodeText', () => {
  it('reads UTF-8, dropping a byte order mark', () => {
    expect(decodeText(bytes('﻿hi ’').buffer as ArrayBuffer)).toBe('hi ’')
  })

  it('reads UTF-16 little-endian with its byte order mark', () => {
    const text = 'SSID 1 : Home'
    const out = new Uint8Array(2 + text.length * 2)
    out.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i++) {
      out[2 + i * 2] = text.charCodeAt(i)
    }
    expect(decodeText(out.buffer)).toBe(text)
  })
})

describe('readTextFile', () => {
  it('returns the text of a readable file', async () => {
    expect(await readTextFile(textFile('{"a":1}'), 100)).toEqual({
      ok: true,
      text: '{"a":1}',
    })
  })

  it('reads a file of exactly the limit', async () => {
    const result = await readTextFile(textFile('abcd'), 4)
    expect(result.ok).toBe(true)
  })

  it('refuses a file over the limit without reading it', async () => {
    let read = false
    const big = {
      size: 500,
      arrayBuffer: () => {
        read = true
        return Promise.resolve(new ArrayBuffer(1))
      },
    }
    const result = await readTextFile(big, 100)
    expect(result.ok).toBe(false)
    expect(read).toBe(false)
  })

  it('says an empty or blank file is empty', async () => {
    for (const empty of [file(new Uint8Array()), textFile('  \n')]) {
      expect(await readTextFile(empty, 100)).toEqual({
        ok: false,
        issues: [{ path: '', message: EMPTY_FILE_MESSAGE }],
      })
    }
  })

  it('says so when the browser fails to read the file', async () => {
    const failing = {
      size: 10,
      arrayBuffer: () => Promise.reject(new Error('x')),
    }
    expect(await readTextFile(failing, 100)).toEqual({
      ok: false,
      issues: [{ path: '', message: UNREADABLE_FILE_MESSAGE }],
    })
  })
})
