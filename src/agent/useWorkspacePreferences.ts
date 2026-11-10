import { useCallback, useRef, useState } from 'react'
import type { WorkspaceCache } from './workspaceCache.ts'
import type { UpdatePreferences } from './workspacePreferences.ts'
import { clearPreferences, loadPreferences, normalisePreferences, savePreferences } from './workspacePreferences.ts'

export function useWorkspacePreferences(cache: WorkspaceCache) {
  const [values, setValues] = useState(() => loadPreferences(cache))
  const current = useRef(values)
  const [warning, setWarning] = useState('')
  const update = useCallback<UpdatePreferences>(change => {
    if (!cache.active) return
    const next = normalisePreferences(change(current.current))
    if (JSON.stringify(next) === JSON.stringify(current.current)) return
    current.current = next; setValues(next)
    // These tiny, non-secret snapshots save immediately, including just before
    // closing Settings/navigation. Revocation still wins over late callbacks.
    setWarning(savePreferences(next, cache) ? '' : 'Remembered fields could not be saved. Your current inputs still work for this page.')
  }, [cache])
  const clear = useCallback(() => {
    if (!cache.active) return false
    const cleared = clearPreferences(cache)
    if (cleared) { current.current = {}; setValues({}); setWarning('') }
    else setWarning('Remembered fields could not be cleared. Clear this tab’s site data before sharing the browser.')
    return cleared
  }, [cache])
  return { values, update, clear, warning }
}
