import { createContext, useContext } from 'react'
import { useStore, type StoreApi } from 'zustand'
import type { EditorState } from './store.ts'

export const EditorContext = createContext<StoreApi<EditorState> | null>(null)

export function useEditorStore(): StoreApi<EditorState> {
  const store = useContext(EditorContext)
  if (!store) throw new Error('useEditor must be used inside <EditorContext>')
  return store
}

/** Reads a slice of editor state and re-renders when it changes. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(useEditorStore(), selector)
}
