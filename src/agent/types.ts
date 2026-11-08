export interface MemoryHit {
  blobId: string
  text: string
  distance: number
  tier?: string
  createdAt?: string
}

export interface MemoryContext {
  memories: MemoryHit[]
  strategy?: string
  tokenEstimate: number
  memoryUnavailable?: boolean
}

export interface MemoryStatus {
  mode: 'mock' | 'relayer' | 'legacy' | 'unconfigured'
  network: string | null
  healthy: boolean
  writeReady: boolean
  accountConfigured: boolean
  accountId?: string | null
  relayerUrl: string
  relayerVersion?: string | null
  error?: string
}

export interface MemoryRecord {
  blobId: string
  namespace: string
  tier?: string
  createdAt?: string
  size?: number
  endEpoch?: number
}

export interface Inventory {
  success: boolean
  total: number
  truncated?: boolean
  meetsHackathonMinimum?: boolean
  namespaces?: { name: string; count: number }[]
  memories: MemoryRecord[]
  recentWrites?: MemoryRecord[]
  error?: string
}

export interface StoredCapture {
  verbatim: number
  facts: number
  failed: number
  blobs: MemoryRecord[]
  pending?: boolean
  skipped?: boolean
  message?: string
}

export interface ToolActivity {
  id: string
  name: string
  status: 'running' | 'done' | 'error'
  preview?: string
}

export interface Proposal {
  id: string
  path: string
  before: string | null
  after: string
  reason: string
  baseHash: string
  status: 'pending' | 'applied' | 'rejected'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  status: 'pending' | 'streaming' | 'complete' | 'stopped' | 'error'
  model?: string
  memory?: MemoryContext
  stored?: StoredCapture
  tools?: ToolActivity[]
  proposals?: Proposal[]
  error?: string
  retryable?: boolean
}

export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model?: string
  messages: ChatMessage[]
}

export interface ProjectFile {
  path: string
  content: string
  selected: boolean
}

export interface Project {
  name: string
  activeFile: string | null
  files: ProjectFile[]
}

export interface Connection {
  mode: 'mock' | 'live' | 'unconfigured'
  model: string
  models: { id: string; label: string }[]
  apiStyle: 'chat' | 'responses'
  baseUrl: string
  toolsEnabled: boolean
  source: string
  verified: boolean
  expiresAt?: string | null
}

export interface WorkspaceStatus {
  agentId: string
  auth: WalletSession
  llm: Connection
  memory: MemoryStatus
  tatum: { configured: boolean; verified: boolean; verifiedAt?: string }
  memoryConnection?: { accountId: string; owner: string; publicKey: string; verified: boolean } | null
}

export interface WalletSession {
  authenticated: boolean
  demo: boolean
  address: string | null
  agentId: string | null
  sessionTag: string | null
  expiresAt: string | null
  demoAvailable: boolean
}

export type WorkspaceMode = 'talk' | 'plan' | 'build'

export interface MemoryOverview {
  status: MemoryStatus
  inventory: Inventory
}

export type AgentEvent =
  | { type: 'memory'; data: MemoryContext }
  | { type: 'delta'; data: { text: string } }
  | { type: 'tool'; data: ToolActivity }
  | { type: 'proposal'; data: Proposal }
  | { type: 'done'; data: { model: string; finishReason: string } }
  | { type: 'stored'; data: StoredCapture }
  | { type: 'error'; data: { code: string; message: string; retryable: boolean } }

export type Phase = 'idle' | 'recalling' | 'thinking' | 'tools' | 'storing'
