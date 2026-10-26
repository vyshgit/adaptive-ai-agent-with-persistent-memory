// Dashboard state is a developer-console view, not the agent recall API.
// Hide every agent-owned record; preserve bootstrap/demo records and explicit dashboard entries.
export function isDashboardVisibleMemory(memory) {
  return !memory?.agentId || memory.agentId === 'recallloop-dashboard'
}
