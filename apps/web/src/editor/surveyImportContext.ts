import { createContext, useContext } from 'react'

export interface SurveyImport {
  /**
   * Opens the file picker to import readings (D72). Rows without a spot go
   * to the selected spot, if one is.
   */
  chooseReadingsFile: () => void
}

export const SurveyImportContext = createContext<SurveyImport | null>(null)

export function useSurveyImport(): SurveyImport {
  const value = useContext(SurveyImportContext)
  if (!value) {
    throw new Error(
      'useSurveyImport must be used inside <SurveyImportProvider>',
    )
  }
  return value
}
