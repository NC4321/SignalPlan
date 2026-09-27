import { createContext, useContext } from 'react'

export interface Tracing {
  /** Opens the file picker for a tracing image. */
  chooseImage: () => void
  /** Opens the file picker to replace the floor's tracing image. */
  replaceImage: () => void
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
