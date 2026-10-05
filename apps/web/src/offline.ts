/// <reference types="vite-plugin-pwa/vanillajs" />
import { safeStorage } from './editor/persistence.ts'

/**
 * Installing SignalPlan and using it offline (D98), behind a switch.
 *
 * Off, the page has no manifest link and registers no service worker, so
 * browsers don't offer to install it and nothing in the UI mentions it.
 * Visiting `/?offline=on` turns it on in that browser only (kept in
 * localStorage); `/?offline=off` turns it off again and removes the worker
 * and its caches. Either way the parameter is taken out of the address bar.
 *
 * This hides the feature, it doesn't secure it: the code and the parameter
 * are public. It only keeps the install prompt away from people until it's
 * ready for them.
 */

/**
 * Whether everyone gets it without the parameter. Set to `true` to open it
 * to everyone: that's the whole change. `/?offline=off` still turns it off
 * in a browser that asked.
 */
export const OFFLINE_FOR_EVERYONE = false

/** Where this browser's choice is kept: `on` or `off`. */
export const OFFLINE_KEY = 'signalplan:offline'

/** The address-bar parameter that sets the choice: `?offline=on` or `off`. */
export const OFFLINE_PARAM = 'offline'

/** The prefix of the service worker's caches (`cacheId` in vite.config.ts). */
export const CACHE_PREFIX = 'signalplan-'

export interface OfflineDecision {
  /** Whether to register the service worker and link the manifest. */
  enabled: boolean
  /** What this visit's parameter asked for, if anything. */
  asked: 'on' | 'off' | undefined
  /** The address without the parameter, when it had one to take out. */
  cleanUrl: string | undefined
}

/**
 * Reads the parameter, keeps what it asked for, and says whether the switch
 * is on in this browser. Storage that throws or is missing counts as no
 * choice, so the visit that asked still gets its way.
 */
export function decideOffline(
  href: string,
  storage: Storage | null = safeStorage(),
  everyone: boolean = OFFLINE_FOR_EVERYONE,
): OfflineDecision {
  const url = new URL(href)
  const value = url.searchParams.get(OFFLINE_PARAM)
  const asked = value === 'on' || value === 'off' ? value : undefined
  let cleanUrl: string | undefined
  if (url.searchParams.has(OFFLINE_PARAM)) {
    url.searchParams.delete(OFFLINE_PARAM)
    cleanUrl = url.pathname + url.search + url.hash
  }
  if (asked) {
    try {
      storage?.setItem(OFFLINE_KEY, asked)
    } catch {
      // Not kept: it applies to this visit only.
    }
  }
  let stored: string | null = null
  try {
    stored = storage?.getItem(OFFLINE_KEY) ?? null
  } catch {
    stored = null
  }
  const choice = asked ?? stored
  return {
    enabled: choice === 'on' || (everyone && choice !== 'off'),
    asked,
    cleanUrl,
  }
}

/**
 * Unregisters every service worker for this site and deletes its caches.
 * Plans are in IndexedDB and settings in localStorage; neither is touched.
 * Says whether there was anything to remove.
 */
export async function removeOffline(
  container: Pick<ServiceWorkerContainer, 'getRegistrations'> | undefined,
  cacheStorage: Pick<CacheStorage, 'keys' | 'delete'> | undefined,
): Promise<boolean> {
  let removed = false
  const registrations = (await container?.getRegistrations()) ?? []
  for (const registration of registrations) {
    removed = (await registration.unregister()) || removed
  }
  const keys = (await cacheStorage?.keys()) ?? []
  for (const key of keys) {
    if (key.startsWith(CACHE_PREFIX)) {
      removed = (await cacheStorage!.delete(key)) || removed
    }
  }
  return removed
}

/** Links the manifest (and the iOS home-screen icon), once. */
function linkManifest(doc: Document) {
  if (doc.querySelector('link[rel="manifest"]')) return
  const manifest = doc.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = '/manifest.webmanifest'
  const touchIcon = doc.createElement('link')
  touchIcon.rel = 'apple-touch-icon'
  touchIcon.href = '/icons/apple-touch-icon.png'
  doc.head.append(manifest, touchIcon)
}

type Listener = () => void
let applyUpdate: (() => void) | undefined
const listeners = new Set<Listener>()

/** A new version is waiting: the function that reloads into it, or none. */
export function pendingUpdate(): (() => void) | undefined {
  return applyUpdate
}

export function onPendingUpdate(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setPendingUpdate(apply: () => void) {
  applyUpdate = apply
  for (const listener of listeners) listener()
}

/** How often an open tab asks whether there's a new version: hourly. */
const UPDATE_CHECK_MS = 60 * 60 * 1000

/**
 * Applies the switch at start-up. It takes the parameter out of the address
 * bar straight away (keeping any `#plan=` link) and does the rest without
 * holding up the editor.
 */
export async function startOffline({
  onReady,
  onTurnedOff,
}: {
  /** The worker has cached the app for the first time. */
  onReady?: () => void
  /** `?offline=off` turned it off. */
  onTurnedOff?: () => void
} = {}): Promise<void> {
  const { enabled, asked, cleanUrl } = decideOffline(window.location.href)
  if (cleanUrl !== undefined) {
    window.history.replaceState(window.history.state, '', cleanUrl)
  }
  if (!('serviceWorker' in navigator)) return
  if (!enabled) {
    await removeOffline(navigator.serviceWorker, globalThis.caches)
    if (asked === 'off') onTurnedOff?.()
    return
  }
  linkManifest(document)
  const { registerSW } = await import('virtual:pwa-register')
  const updateSW = registerSW({
    immediate: true,
    // A new deploy installs in the background and waits; the banner offers
    // to reload into it, which tells it to take over (D98).
    onNeedRefresh: () => setPendingUpdate(() => void updateSW(true)),
    onOfflineReady: () => onReady?.(),
    onRegisteredSW: (_url, registration) => {
      if (!registration) return
      setInterval(() => {
        if (navigator.onLine) void registration.update().catch(() => {})
      }, UPDATE_CHECK_MS)
    },
  })
}
