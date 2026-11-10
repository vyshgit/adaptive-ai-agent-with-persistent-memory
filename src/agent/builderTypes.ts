import type { MemoryHit, StoredCapture } from './types.ts'

interface ReviewIdentity { id: string; workspaceId: string; digest: string; expiresAt: number; source: 'manual' | 'agent'; permissionReason?: string }
export type BuilderMode = 'build' | 'plan'
export type PermissionMode = 'standard' | 'strict'
export type BuilderApproval = ReviewIdentity & (
  | { kind: 'file'; path: string; before: string | null; after: string | null; version: string | null; reason: string; operation: 'create' | 'update' | 'delete' }
  | { kind: 'command'; command: string; cwd: string; timeoutMs: number; reason: string }
  | { kind: 'memory'; text: string; project: string; revision: string; tier: 'facts' }
)
export interface BuilderStatus {
  enabled: boolean; opened: boolean; workspaceId: string | null; root: string | null; name: string | null
  launchRoot?: string | null
  task: { id: string; kind: string } | null; memoryEpoch: number; permissionMode: PermissionMode | null; approvals: BuilderApproval[]; folderNotice: string; commandNotice: string
  limits: { fileBytes: number; toolCalls: number; modelCalls: number; outputTokens: number; turnMs: number; commandMs: number; historyMessages: number; historyCharacters: number }
}
export interface LocalFile { path: string; content: string | null; version: string | null; bytes: number; redacted: boolean }
export interface LocalEntry { path: string; name: string; type: 'directory' | 'file'; bytes: number }
export interface LocalListing { path: string; entries: LocalEntry[]; truncated: boolean }
export interface LocalFolders {
  path: string; parent: string | null; home: string; launch: string; entries: { name: string; path: string }[]
  truncated: boolean; selectable: boolean; issue: string | null
}
export interface LocalSearch { matches: { path: string; line?: number; text?: string }[]; truncated: boolean }
export interface LocalTool { id: string; name: string; path?: string; command?: string; status: 'running' | 'waiting' | 'complete' | 'rejected' | 'blocked' | 'error'; summary?: string; output?: string; exitCode?: number | null; commandStatus?: string }
export interface LocalRun { id: string; prompt: string; answer: string; status: 'running' | 'complete' | 'stopped' | 'error'; mode: BuilderMode; model: string; tools: LocalTool[]; requests?: number; error?: string; memories?: MemoryHit[]; memoryUnavailable?: boolean; memoryTruncated?: boolean; recalling?: boolean; stored?: StoredCapture }
export interface BuilderRecall { recallId: string; expiresAt: number; memories: MemoryHit[]; unavailable: boolean; warning: string }
export interface StaticPreview { id: string; url: string; expiresAt: number; files: number; bytes: number; warning: string }
export interface CheckpointDraft { project: string; revision: string; preferences: string; decisions: string; nextSteps: string }
