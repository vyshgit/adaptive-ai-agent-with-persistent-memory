import { useEffect, useState } from 'react'
import type { Connection } from './types.ts'
import type { ModelPreference } from './workspacePreferences.ts'
import { connectionPreference, preferredConnection, preferredModel } from './workspacePreferences.ts'
import { modelChoice } from './providers.ts'

export function useModelSelection(connections: Connection[], fallback: Connection | undefined, preference: ModelPreference | undefined,
  remember: (value: ModelPreference) => void) {
  const [selected, setSelected] = useState(preference)
  const connection = preferredConnection(connections, fallback, selected)
  const model = preferredModel(connection, selected)
  const value = connection ? modelChoice(connection, model) : ''
  const preferenceAvailable = Boolean(preference && connections.some(profile => profile.id === preference.connectionId && profile.baseUrl === preference.baseUrl
    && profile.apiStyle === preference.apiStyle && profile.models.some(item => item.id === preference.model)))
  // Pin the actual profile, endpoint and protocol. A status refresh adding a
  // different provider must not silently rebind an existing model selection.
  useEffect(() => {
    if (connection) setSelected(connectionPreference(connection, model))
    else setSelected(undefined)
  }, [value, connection?.baseUrl, connection?.apiStyle])
  useEffect(() => {
    // An explicit connection choice can arrive before its refreshed catalogue.
    // Apply it once that exact profile/model becomes available, even if the
    // saved preference itself has not changed during the status request.
    if (preferenceAvailable) setSelected(preference)
  }, [preference?.connectionId, preference?.baseUrl, preference?.apiStyle, preference?.model, preferenceAvailable])
  function choose(value: string) {
    for (const profile of connections) {
      const next = profile.models.find(item => modelChoice(profile, item.id) === value)
      if (!next) continue
      const selection = connectionPreference(profile, next.id)
      setSelected(selection); remember(selection); return
    }
  }
  return { connection, model, value, choose }
}
