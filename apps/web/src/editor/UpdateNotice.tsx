import { useSyncExternalStore } from 'react'
import { onPendingUpdate, pendingUpdate } from '../offline.ts'

/**
 * A line under the top bar when a new version has been downloaded for
 * offline use and is waiting (D98). Reload swaps it in; until then the open
 * version keeps working. Only a browser with offline use on ever sees it.
 */
export function UpdateNotice() {
  const apply = useSyncExternalStore(onPendingUpdate, pendingUpdate)
  if (!apply) return null
  return (
    <p className="storage-notice update-notice">
      <span>A new version of SignalPlan is ready.</span>
      <button type="button" onClick={apply}>
        Reload to update
      </button>
    </p>
  )
}
