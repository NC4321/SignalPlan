import { createContext, useContext } from 'react'

export interface Scan {
  /** Opens Scan your network (D77, D80). */
  openScan: () => void
}

export const ScanContext = createContext<Scan | null>(null)

export function useScan(): Scan {
  const value = useContext(ScanContext)
  if (!value) throw new Error('useScan must be used inside <ScanProvider>')
  return value
}
