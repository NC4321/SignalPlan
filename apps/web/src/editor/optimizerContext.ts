import { createContext, useContext } from 'react'
import type { Optimizer } from './optimizer.ts'

export const OptimizerContext = createContext<Optimizer | null>(null)

export function useOptimizer(): Optimizer {
  const optimizer = useContext(OptimizerContext)
  if (!optimizer) {
    throw new Error('useOptimizer must be used inside <OptimizerContext>')
  }
  return optimizer
}
