import type { Connection } from './types.ts'
import { connectionLabel, modelChoice, modelLabel } from './providers.ts'

export default function ModelOptions({ connections }: { connections: Connection[] }) {
  if (!connections.length) return <option value="">No model connected</option>
  return <>{connections.map((connection, index) => <optgroup key={connection.id || index} label={connectionLabel(connection)}>
    {connection.models.map(model => <option key={model.id} value={modelChoice(connection, model.id)}>{connectionLabel(connection)} · {modelLabel(model)}</option>)}
  </optgroup>)}</>
}
