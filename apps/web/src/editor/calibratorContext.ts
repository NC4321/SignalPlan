import { createContext, useContext } from 'react'
import type { ModelCalibrator } from './modelCalibration.ts'

export const CalibratorContext = createContext<ModelCalibrator | null>(null)

export function useCalibrator(): ModelCalibrator {
  const calibrator = useContext(CalibratorContext)
  if (!calibrator) {
    throw new Error('useCalibrator must be used inside <CalibratorContext>')
  }
  return calibrator
}
