import { describe, expect, it } from 'vitest'
import {
  decideOffline,
  OFFLINE_FOR_EVERYONE,
  OFFLINE_KEY,
  removeOffline,
} from './offline.ts'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, value),
  }
}

/** Storage that throws on every call, as when the browser blocks it. */
const blocked = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
} as unknown as Storage

const at = (path: string) => `https://signalplan.pages.dev${path}`

describe('the offline switch (D98)', () => {
  it('is off for everyone until it ships', () => {
    expect(OFFLINE_FOR_EVERYONE).toBe(false)
    expect(decideOffline(at('/'), memoryStorage())).toEqual({
      enabled: false,
      asked: undefined,
      cleanUrl: undefined,
    })
  })

  it('turns on in this browser with ?offline=on, and stays on', () => {
    const storage = memoryStorage()
    expect(decideOffline(at('/?offline=on'), storage)).toEqual({
      enabled: true,
      asked: 'on',
      cleanUrl: '/',
    })
    expect(storage.getItem(OFFLINE_KEY)).toBe('on')
    expect(decideOffline(at('/'), storage).enabled).toBe(true)
    // Another browser hasn't asked.
    expect(decideOffline(at('/'), memoryStorage()).enabled).toBe(false)
  })

  it('turns off again with ?offline=off', () => {
    const storage = memoryStorage()
    decideOffline(at('/?offline=on'), storage)
    expect(decideOffline(at('/?offline=off'), storage)).toEqual({
      enabled: false,
      asked: 'off',
      cleanUrl: '/',
    })
    expect(decideOffline(at('/'), storage).enabled).toBe(false)
  })

  it('keeps the rest of the address when it takes the parameter out', () => {
    expect(
      decideOffline(at('/?a=1&offline=on&b=2#plan=1.xyz'), memoryStorage())
        .cleanUrl,
    ).toBe('/?a=1&b=2#plan=1.xyz')
    // Any other value is taken out too, and changes nothing.
    const storage = memoryStorage()
    expect(decideOffline(at('/?offline=yes'), storage)).toEqual({
      enabled: false,
      asked: undefined,
      cleanUrl: '/',
    })
    expect(storage.getItem(OFFLINE_KEY)).toBeNull()
  })

  it('applies to the visit that asked when storage is blocked or missing', () => {
    expect(decideOffline(at('/?offline=on'), blocked).enabled).toBe(true)
    expect(decideOffline(at('/'), blocked).enabled).toBe(false)
    expect(decideOffline(at('/?offline=on'), null).enabled).toBe(true)
  })

  it('is on for everyone once opened, except where turned off', () => {
    const storage = memoryStorage()
    expect(decideOffline(at('/'), storage, true).enabled).toBe(true)
    expect(decideOffline(at('/?offline=off'), storage, true).enabled).toBe(
      false,
    )
    expect(decideOffline(at('/'), storage, true).enabled).toBe(false)
    expect(decideOffline(at('/?offline=on'), storage, true).enabled).toBe(true)
  })
})

describe('removeOffline', () => {
  it('unregisters the workers and deletes only its own caches', async () => {
    let unregistered = 0
    const registration = {
      unregister: async () => {
        unregistered++
        return true
      },
    } as ServiceWorkerRegistration
    const keys = ['signalplan-precache-v2-https://x/', 'someone-else']
    const deleted: string[] = []
    const removed = await removeOffline(
      { getRegistrations: async () => [registration] },
      {
        keys: async () => keys,
        delete: async (key: string) => {
          deleted.push(key)
          return true
        },
      },
    )
    expect(removed).toBe(true)
    expect(unregistered).toBe(1)
    expect(deleted).toEqual(['signalplan-precache-v2-https://x/'])
  })

  it('does nothing where there is nothing to remove', async () => {
    expect(
      await removeOffline(
        { getRegistrations: async () => [] },
        { keys: async () => [], delete: async () => false },
      ),
    ).toBe(false)
    expect(await removeOffline(undefined, undefined)).toBe(false)
  })
})
