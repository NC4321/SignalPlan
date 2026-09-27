import { createContext, useContext } from 'react'
import type { Autosaver } from './autosave.ts'
import type { PlanLibrary } from './library.ts'

/** Things outside the store that the editor needs: storage and autosave. */
export interface EditorServices {
  /** Undefined where the browser blocks storage. */
  library: PlanLibrary | undefined
  autosaver: Autosaver
}

export const ServicesContext = createContext<EditorServices | null>(null)

export function useServices(): EditorServices {
  const services = useContext(ServicesContext)
  if (!services)
    throw new Error('useServices must be used inside <ServicesContext>')
  return services
}
