import { createContext, useContext } from 'react'

export interface Tracing {
  /** Opens the file picker to add, or replace, the floor's tracing image. */
  chooseImage: () => void
  /** A note about the last image added, such as its size. */
  notice: string | undefined
}

export const TracingContext = createContext<Tracing | null>(null)

export function useTracing(): Tracing {
  const tracing = useContext(TracingContext)
  if (!tracing)
    throw new Error('useTracing must be used inside <TracingProvider>')
  return tracing
}
