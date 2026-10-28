import React, { useState, useEffect } from 'react'
import {
  Brain,
  History,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ArrowRight,
  TrendingUp,
  RefreshCw,
  Target,
  FileText,
  AlertCircle,
  HelpCircle,
  Layers,
  ChevronRight,
  Bookmark,
  ExternalLink,
  PlusCircle,
  Sliders,
  Database,
  ArrowDownRight,
  Check,
  ShieldAlert,
  Edit3,
  ChevronDown
} from 'lucide-react'

interface Memory {
  id: string
  blobId: string
  storageType: string
  sessionNumber: number
  type: string
  title: string
  taskTitle: string
  plannedDurationMinutes: number
  outcome: 'completed' | 'postponed' | 'failed' | 'neutral'
  feedback: string
  lesson: string
  timestamp: string
  walrusEpoch?: number
}

interface Hypothesis {
  id: string
  code: string
  title: string
  description: string
  confidence: number
  sampleSize: number
  supportingEvidence: string
  status: string
  lastUpdated: string
}

interface PolicyRule {
  id: string
  name: string
  description: string
  enforced: boolean
  derivedFrom: string
}

interface Policy {
  version: number
  name: string
  rules: PolicyRule[]
}

interface PlanTask {
  id: string
  title: string
  category: string
  durationMinutes: number
  priority: 'High' | 'Medium' | 'Low'
  status: 'pending' | 'completed' | 'postponed' | 'failed'
  rationale: string
  influencedByMemories: string[]
  feedback?: string
  outcomeReason?: string
  completedAt?: string | null
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'plan' | 'hypotheses' | 'memories'>('plan')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [memories, setMemories] = useState<Memory[]>([])
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([])
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [plan, setPlan] = useState<PlanTask[]>([])
  const [publisherUrl, setPublisherUrl] = useState('')
  const [aggregatorUrl, setAggregatorUrl] = useState('')
  const [walrusNetwork, setWalrusNetwork] = useState('testnet')
  const [sdkInfo, setSdkInfo] = useState<any>(null)
  const [suiCheckpoint, setSuiCheckpoint] = useState<any>(null)

  // Goal & Constraints Input State
  const [goalInput, setGoalInput] = useState('Build & Launch RecallLoop MVP with Walrus Memory')
  const [durationConstraint, setDurationConstraint] = useState('2 hours evening sprint')
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false)
  const [planGeneratedNotice, setPlanGeneratedNotice] = useState<string | null>(null)

  // Outcome Reporting Modal State
  const [selectedTaskForOutcome, setSelectedTaskForOutcome] = useState<PlanTask | null>(null)
  const [outcomeStatus, setOutcomeStatus] = useState<'completed' | 'postponed' | 'failed'>('completed')
  const [outcomeReason, setOutcomeReason] = useState('')
  const [outcomeFeedback, setOutcomeFeedback] = useState('')
  const [isSubmittingOutcome, setIsSubmittingOutcome] = useState(false)

  // User Hypothesis Correction
  const [editingHypothesis, setEditingHypothesis] = useState<Hypothesis | null>(null)
  const [correctionConfidence, setCorrectionConfidence] = useState(0.5)
  const [correctionNote, setCorrectionNote] = useState('')

  // Raw Blob Inspector Modal
  const [inspectingBlobId, setInspectingBlobId] = useState<string | null>(null)
  const [inspectedBlobData, setInspectedBlobData] = useState<any>(null)
  const [loadingBlob, setLoadingBlob] = useState(false)

  // Manual Memory Entry Modal
  const [showAddMemoryModal, setShowAddMemoryModal] = useState(false)
  const [newMemTitle, setNewMemTitle] = useState('')
  const [newMemTask, setNewMemTask] = useState('')
  const [newMemOutcome, setNewMemOutcome] = useState<'completed' | 'postponed' | 'failed'>('completed')
  const [newMemDuration, setNewMemDuration] = useState(25)
  const [newMemLesson, setNewMemLesson] = useState('')
  const [isStoringMemory, setIsStoringMemory] = useState(false)

  // Fetch initial state
  const loadState = async () => {
    try {
      setSyncing(true)
      const res = await fetch('/api/walrus/state')
      if (res.ok) {
        const data = await res.json()
        setMemories(data.memories || [])
        setHypotheses(data.hypotheses || [])
        setPolicy(data.policy || null)
        setPlan(data.plan || [])
        setPublisherUrl(data.publisherUrl || '')
        setAggregatorUrl(data.aggregatorUrl || '')
        setWalrusNetwork(data.network || 'unknown')
        setSdkInfo(data.sdk || null)
      }

      // Check Tatum Sui RPC
      try {
        const suiRes = await fetch('/api/tatum/sui-checkpoint')
        if (suiRes.ok) {
          const suiData = await suiRes.json()
          setSuiCheckpoint(suiData)
        }
      } catch (err) {
        console.warn('Tatum Sui RPC check error:', err)
      }
    } catch (e) {
      console.error('Failed to load state', e)
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  // Generate / Adapt Plan
  const handleGeneratePlan = async () => {
    try {
      setIsGeneratingPlan(true)
      const res = await fetch('/api/walrus/plan/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goalInput, constraints: durationConstraint })
      })
      if (res.ok) {
        const data = await res.json()
        setPlan(data.plan)
        setPlanGeneratedNotice(data.memoryInfluenceSummary)
        setTimeout(() => setPlanGeneratedNotice(null), 8000)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsGeneratingPlan(false)
    }
  }

  // Submit Task Outcome
  const handleSubmitOutcome = async () => {
    if (!selectedTaskForOutcome) return
    try {
      setIsSubmittingOutcome(true)
      const res = await fetch('/api/walrus/task/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: selectedTaskForOutcome.id,
          outcome: outcomeStatus,
          feedback: outcomeFeedback,
          outcomeReason
        })
      })
      if (res.ok) {
        const data = await res.json()
        setPlan(data.updatedPlan)
        setHypotheses(data.updatedHypotheses)
        setMemories(prev => [data.newMemory, ...prev])
        setSelectedTaskForOutcome(null)
        setOutcomeFeedback('')
        setOutcomeReason('')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsSubmittingOutcome(false)
    }
  }

  // Inspect Raw Walrus Blob
  const handleInspectBlob = async (blobId: string) => {
    setInspectingBlobId(blobId)
    setLoadingBlob(true)
    setInspectedBlobData(null)
    try {
      const res = await fetch(`/api/walrus/blob/${encodeURIComponent(blobId)}`)
      if (res.ok) {
        const data = await res.json()
        setInspectedBlobData(data)
      } else {
        setInspectedBlobData({ error: `Aggregator returned ${res.status}` })
      }
    } catch (e: any) {
      setInspectedBlobData({ error: e.message })
    } finally {
      setLoadingBlob(false)
    }
  }

  // Save Hypothesis Correction
  const handleSaveCorrection = async () => {
    if (!editingHypothesis) return
    try {
      const res = await fetch('/api/walrus/hypotheses/user-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hypothesisId: editingHypothesis.id,
          newConfidence: correctionConfidence,
          userNote: correctionNote
        })
      })
      if (res.ok) {
        const data = await res.json()
        setHypotheses(prev => prev.map(h => (h.id === data.hypothesis.id ? data.hypothesis : h)))
        setEditingHypothesis(null)
        setCorrectionNote('')
      }
    } catch (e) {
      console.error(e)
    }
  }

  // Store Manual Memory
  const handleAddManualMemory = async () => {
    if (!newMemTitle) return
    try {
      setIsStoringMemory(true)
      const res = await fetch('/api/walrus/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: 'recallloop-dashboard',
          title: newMemTitle,
          taskTitle: newMemTask,
          outcome: newMemOutcome,
          plannedDurationMinutes: newMemDuration,
          feedback: 'User recorded past experience lesson.',
          lesson: newMemLesson
        })
      })
      if (res.ok) {
        const data = await res.json()
        setMemories(prev => [data.memory, ...prev])
        setShowAddMemoryModal(false)
        setNewMemTitle('')
        setNewMemTask('')
        setNewMemLesson('')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setIsStoringMemory(false)
    }
  }

  return (
    <div className="min-h-screen bg-primary text-primary flex flex-col font-sans">
      {/* 10. Dashboard Layout App Shell: Page Header */}
      <header className="flex flex-col gap-lg border-b border-secondary bg-primary p-xl lg:flex-row lg:items-start lg:justify-between sticky top-0 z-20 shadow-xs">
        <div className="flex items-start gap-md min-w-0">
          <div className="p-sm bg-utility-brand-50 border border-utility-brand-200 rounded-md shrink-0">
            <Brain className="w-5 h-5 text-brand-primary" />
          </div>
          <div>
            <div className="flex items-center gap-sm flex-wrap">
              <h1 className="text-heading-xs font-semibold text-primary">RecallLoop</h1>
              {/* 4. Badge recipe: Tinted pill */}
              <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                Adaptive AI Agent
              </span>
              <span className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">
                Walrus Mainnet Config
              </span>
            </div>
            <p className="mt-xs text-sm text-tertiary">An AI agent that learns what works, remembers what fails, and adapts its next decision.</p>
          </div>
        </div>

        <div className="flex items-center gap-md shrink-0">
          <span className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">
            <span className="w-1.5 h-1.5 rounded-full bg-utility-success-600 animate-pulse" />
            Walrus Memories: {memories.length}
          </span>
          {/* 1. Button recipe: Secondary button */}
          <button
            onClick={loadState}
            disabled={syncing}
            className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-fg-tertiary ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync Walrus</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-xl flex flex-col lg:flex-row gap-xl items-start">
        {/* Left Column: Goal Input, Active Plan, Tabs */}
        <div className="flex-1 w-full flex flex-col gap-xl">
          {/* 3. Card recipe: Section container */}
          <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-xs text-brand-primary font-medium text-xs">
                <Target className="w-4 h-4 text-fg-brand-primary" />
                <span>EXPERIENCE-TO-POLICY PLANNING LOOP</span>
              </div>
              <span className="text-xs text-tertiary">Persistent across sessions</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-lg">
              {/* 2. Input recipe: Input & Field */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Current Goal</label>
                <input
                  type="text"
                  value={goalInput}
                  onChange={e => setGoalInput(e.target.value)}
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                  placeholder="e.g. Build MVP features"
                />
                <p className="text-xs text-tertiary">Define the target outcome for this working session.</p>
              </div>

              {/* 2. Input recipe: Input & Field */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Session Time & Constraints</label>
                <input
                  type="text"
                  value={durationConstraint}
                  onChange={e => setDurationConstraint(e.target.value)}
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                  placeholder="e.g. 2 hours evening sprint"
                />
                <p className="text-xs text-tertiary">Agent matches time limits with past performance memories.</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-xs border-t border-secondary">
              <p className="text-xs text-tertiary flex items-center gap-xs">
                <Sparkles className="w-4 h-4 text-fg-brand-primary shrink-0" />
                <span>The agent consults decentralized Walrus Memory to formulate recommendations.</span>
              </p>
              {/* 1. Button recipe: Primary button */}
              <button
                onClick={handleGeneratePlan}
                disabled={isGeneratingPlan}
                className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 shrink-0"
              >
                {isGeneratingPlan ? (
                  <RefreshCw className="w-4 h-4 text-fg-white animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 text-fg-white" />
                )}
                <span>Adapt Plan From Experience</span>
              </button>
            </div>

            {/* 7. Alert recipe: Tinted callout */}
            {planGeneratedNotice && (
              <div className="flex gap-lg rounded-xl bg-utility-brand-50 p-xl border border-utility-brand-200">
                <Sparkles className="mt-xxs w-5 h-5 shrink-0 text-utility-brand-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-utility-brand-600">Adaptive Policy Applied</p>
                  <p className="mt-xxs text-sm text-tertiary">{planGeneratedNotice}</p>
                </div>
              </div>
            )}
          </section>

          {/* 5. Tabs recipe: Baseline divider + buttons */}
          <div className="flex gap-lg border-b border-secondary">
            <button
              onClick={() => setActiveTab('plan')}
              className={`px-md py-sm text-sm font-semibold transition-colors ${
                activeTab === 'plan'
                  ? 'border-b-2 border-brand text-brand-primary'
                  : 'border-b-2 border-transparent text-tertiary hover:text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring'
              }`}
            >
              Prioritized Action Plan ({plan.length})
            </button>
            <button
              onClick={() => setActiveTab('hypotheses')}
              className={`px-md py-sm text-sm font-semibold transition-colors ${
                activeTab === 'hypotheses'
                  ? 'border-b-2 border-brand text-brand-primary'
                  : 'border-b-2 border-transparent text-tertiary hover:text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring'
              }`}
            >
              Hypotheses & Confidence ({hypotheses.length})
            </button>
            <button
              onClick={() => setActiveTab('memories')}
              className={`px-md py-sm text-sm font-semibold transition-colors ${
                activeTab === 'memories'
                  ? 'border-b-2 border-brand text-brand-primary'
                  : 'border-b-2 border-transparent text-tertiary hover:text-secondary focus-visible:ring-2 focus-visible:ring-focus-ring'
              }`}
            >
              Walrus Blobs Store ({memories.length})
            </button>
          </div>

          {/* Tab 1: Prioritized Plan View */}
          {activeTab === 'plan' && (
            <div className="flex flex-col gap-md">
              {plan.map((task, idx) => (
                /* 3. Card recipe */
                <section
                  key={task.id}
                  className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-md"
                >
                  <div className="flex items-start justify-between gap-md">
                    <div className="flex items-start gap-md">
                      <div
                        className={`p-xs rounded-md mt-xxs shrink-0 ${
                          task.status === 'completed'
                            ? 'bg-utility-success-50 text-utility-success-700'
                            : task.status === 'failed'
                            ? 'bg-utility-error-50 text-utility-error-700'
                            : 'bg-utility-brand-50 text-brand-primary'
                        }`}
                      >
                        {task.status === 'completed' ? (
                          <CheckCircle2 className="w-4 h-4 text-fg-success-primary" />
                        ) : task.status === 'failed' ? (
                          <XCircle className="w-4 h-4 text-fg-error-primary" />
                        ) : (
                          <Clock className="w-4 h-4 text-fg-brand-primary" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-sm flex-wrap">
                          <span className="text-sm font-semibold text-primary">
                            {idx + 1}. {task.title}
                          </span>
                          {/* 4. Badge recipe */}
                          <span className="inline-flex items-center gap-xs rounded-full border border-utility-gray-200 bg-utility-gray-50 px-md py-xxs text-xs font-medium text-utility-gray-700">
                            {task.durationMinutes} min
                          </span>
                          <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                            {task.category}
                          </span>
                          {task.status !== 'pending' && (
                            <span
                              className={`inline-flex items-center gap-xs rounded-full border px-md py-xxs text-xs font-medium ${
                                task.status === 'completed'
                                  ? 'border-utility-success-200 bg-utility-success-50 text-utility-success-700'
                                  : task.status === 'postponed'
                                  ? 'border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700'
                                  : 'border-utility-error-200 bg-utility-error-50 text-utility-error-700'
                              }`}
                            >
                              {task.status.toUpperCase()}
                            </span>
                          )}
                        </div>

                        {/* Rationale & Memory Influence */}
                        <div className="mt-xs flex flex-col gap-xxs">
                          <p className="text-xs text-secondary">
                            <span className="font-semibold text-primary">Why recommended: </span>
                            {task.rationale}
                          </p>

                          {task.influencedByMemories && task.influencedByMemories.length > 0 && (
                            <div className="flex items-center gap-xs mt-xxs text-xs text-tertiary">
                              <Bookmark className="w-3.5 h-3.5 text-fg-brand-primary" />
                              <span>Memory evidence: </span>
                              {task.influencedByMemories.map(mId => (
                                <button
                                  key={mId}
                                  type="button"
                                  className="underline text-brand-primary cursor-pointer hover:text-brand-primary"
                                  onClick={() => {
                                    const mem = memories.find(m => m.id === mId)
                                    if (mem) handleInspectBlob(mem.blobId)
                                  }}
                                >
                                  {mId}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 1. Button recipe: Action button */}
                    {task.status === 'pending' && (
                      <button
                        onClick={() => {
                          setSelectedTaskForOutcome(task)
                          setOutcomeStatus('completed')
                        }}
                        className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0"
                      >
                        <Check className="w-3.5 h-3.5 text-fg-tertiary" />
                        <span>Record Outcome</span>
                      </button>
                    )}
                  </div>

                  {/* Feedback note if present */}
                  {task.feedback && (
                    <div className="bg-secondary p-md rounded-md border border-secondary text-xs text-secondary mt-xs">
                      <span className="font-semibold text-primary">Observed Outcome Note: </span>
                      {task.feedback}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}

          {/* Tab 2: Hypotheses & Confidence View */}
          {activeTab === 'hypotheses' && (
            <div className="flex flex-col gap-md">
              {/* 7. Alert recipe */}
              <div className="flex gap-lg rounded-xl bg-utility-brand-50 p-xl border border-utility-brand-200">
                <TrendingUp className="mt-xxs w-5 h-5 shrink-0 text-utility-brand-600" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-utility-brand-600">Adaptive Hypothesis Testing</p>
                  <p className="mt-xxs text-sm text-tertiary">
                    RecallLoop maintains explicit hypotheses about working habits and adapts Bayesian confidence
                    percentages as outcomes are observed. You can also correct any assumption manually.
                  </p>
                </div>
              </div>

              {hypotheses.map(hyp => (
                /* 3. Card recipe */
                <section
                  key={hyp.id}
                  className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-md"
                >
                  <div className="flex items-start justify-between gap-md">
                    <div>
                      <div className="flex items-center gap-sm">
                        {/* 4. Badge recipe */}
                        <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-semibold text-utility-brand-700">
                          {hyp.code}
                        </span>
                        <h3 className="text-sm font-semibold text-primary">{hyp.title}</h3>
                      </div>
                      <p className="text-xs text-secondary mt-xs">{hyp.description}</p>
                    </div>

                    <div className="flex flex-col items-end gap-xs shrink-0">
                      <div className="flex items-center gap-xs">
                        <span className="text-xs text-tertiary">Confidence:</span>
                        <span className="text-sm font-semibold text-brand-primary">
                          {Math.round(hyp.confidence * 100)}%
                        </span>
                      </div>
                      {/* 8. Progress Bar recipe: Track + Fill */}
                      <div className="h-2 w-32 overflow-hidden rounded-full bg-tertiary border border-secondary">
                        <div
                          className="h-full rounded-full bg-brand-solid transition-all"
                          style={{ width: `${Math.round(hyp.confidence * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-secondary p-md rounded-md border border-secondary flex items-start justify-between gap-md">
                    <div className="flex flex-col gap-xxs text-xs">
                      <span className="font-semibold text-primary">
                        Observed Evidence & Sample Size ({hyp.sampleSize} data points):
                      </span>
                      <p className="text-secondary">{hyp.supportingEvidence}</p>
                    </div>

                    {/* 1. Button recipe: Secondary button */}
                    <button
                      onClick={() => {
                        setEditingHypothesis(hyp)
                        setCorrectionConfidence(hyp.confidence)
                      }}
                      className="inline-flex items-center gap-sm rounded-lg bg-primary px-md py-xs text-xs font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring shrink-0"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-fg-tertiary" />
                      <span>Correct Assumption</span>
                    </button>
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* Tab 3: Walrus Memory Store View */}
          {activeTab === 'memories' && (
            <div className="flex flex-col gap-md">
              <div className="flex items-center justify-between">
                <p className="text-xs text-tertiary">
                  Every experience lesson is serialized and anchored into Walrus Memory blobs for decentralized
                  cross-session retrieval.
                </p>
                {/* 1. Button recipe */}
                <button
                  onClick={() => setShowAddMemoryModal(true)}
                  className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <PlusCircle className="w-4 h-4 text-fg-brand-primary" />
                  <span>Record Experience Entry</span>
                </button>
              </div>

              {memories.map(mem => (
                /* 3. Card recipe */
                <section
                  key={mem.id}
                  className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-sm"
                >
                  <div className="flex items-center justify-between gap-md">
                    <div className="flex items-center gap-sm">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          mem.outcome === 'completed'
                            ? 'bg-utility-success-600'
                            : mem.outcome === 'failed'
                            ? 'bg-utility-error-600'
                            : 'bg-utility-warning-600'
                        }`}
                      />
                      <span className="text-sm font-semibold text-primary">{mem.title}</span>
                      <span className="text-xs text-tertiary">Session #{mem.sessionNumber}</span>
                    </div>

                    <button
                      onClick={() => handleInspectBlob(mem.blobId)}
                      className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-mono text-utility-brand-700 hover:underline"
                    >
                      <Database className="w-3 h-3 text-fg-brand-primary" />
                      <span>{mem.blobId.slice(0, 16)}...</span>
                      <ExternalLink className="w-3 h-3 ml-xxs text-fg-brand-primary" />
                    </button>
                  </div>

                  <p className="text-xs text-secondary">
                    <span className="font-semibold text-primary">Context: </span>
                    {mem.taskTitle} ({mem.plannedDurationMinutes}m) → Outcome:{' '}
                    <span className="font-semibold uppercase">{mem.outcome}</span>
                  </p>

                  <div className="bg-secondary p-md rounded-md border border-secondary flex flex-col gap-xxs text-xs">
                    <span className="font-semibold text-primary">Extracted Lesson / Policy Rule:</span>
                    <p className="text-secondary">{mem.lesson}</p>
                    {mem.feedback && <p className="text-tertiary italic">User Feedback: "{mem.feedback}"</p>}
                  </div>

                  <div className="flex items-center justify-between text-xs text-tertiary pt-xxs">
                    <span>Stored at: {new Date(mem.timestamp).toLocaleString()}</span>
                    <span>Epoch #{mem.walrusEpoch || 562}</span>
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Policies & Walrus System Info */}
        <div className="w-full lg:w-80 flex flex-col gap-xl shrink-0">
          {/* 3. Card recipe: Adapted Policies */}
          <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-xs text-brand-primary font-medium text-xs">
                <Bookmark className="w-4 h-4 text-fg-brand-primary" />
                <span>ADAPTED POLICIES</span>
              </div>
              <span className="text-xs text-tertiary">v{policy?.version || 3}</span>
            </div>

            <p className="text-xs text-secondary">
              Derived automatically from accumulated Walrus memories to guide future planning:
            </p>

            <div className="flex flex-col gap-sm">
              {policy?.rules.map(rule => (
                <div key={rule.id} className="bg-secondary p-md rounded-md border border-secondary flex flex-col gap-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">{rule.name}</span>
                    <span className="inline-flex items-center rounded-full border border-utility-brand-200 bg-utility-brand-50 px-xs py-xxs text-xs font-mono text-utility-brand-700">
                      {rule.derivedFrom}
                    </span>
                  </div>
                  <p className="text-xs text-secondary">{rule.description}</p>
                </div>
              ))}
            </div>
          </section>

          {/* 3. Card recipe: Walrus Integration Network */}
          <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-md">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-primary">Walrus Memory Network</span>
              {/* 4. Badge recipe */}
              <span className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">
                Connected
              </span>
            </div>

            <div className="flex flex-col gap-sm text-xs text-secondary">
              <div className="flex justify-between">
                <span>MemWal SDK:</span>
                <span className="font-semibold text-utility-brand-700">
                  v{sdkInfo?.sdkVersion || '0.1.10'} ({sdkInfo?.status === 'ready' ? 'Ready' : 'Installed'})
                </span>
              </div>
              <div className="flex justify-between">
                <span>Configured network:</span>
                <span className="font-semibold text-utility-brand-700">{walrusNetwork}</span>
              </div>
              <div className="flex justify-between">
                <span>Publisher Node:</span>
                <span className="font-mono text-tertiary text-xs">{publisherUrl.includes('nodes.guru') ? 'nodes.guru' : 'custom endpoint'}</span>
              </div>
              <div className="flex justify-between">
                <span>Aggregator Node:</span>
                <span className="font-mono text-tertiary text-xs">nodes.guru</span>
              </div>
              <div className="flex justify-between">
                <span>Total Stored Blobs:</span>
                <span className="font-semibold text-primary">{memories.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Tatum Sui Mainnet Gateway:</span>
                <span className="font-semibold text-utility-brand-700">
                  {suiCheckpoint ? `Status ${suiCheckpoint.status}` : 'Initialized'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Blob retrieval:</span>
                <span className="font-semibold text-primary">On demand</span>
              </div>
            </div>

            {sdkInfo?.blockerNotice && (
              <div className="p-xs rounded-md bg-utility-gray-50 border border-utility-gray-200 text-xs text-secondary">
                <span className="font-semibold text-primary">Relayer Notice: </span>
                {sdkInfo.blockerNotice}
              </div>
            )}

            <p className="pt-sm border-t border-secondary text-xs text-tertiary">
              Memory blobs remain retrievable across restarts, browser wipes, and multi-session workflows.
            </p>
          </section>
        </div>
      </main>

      {/* 6. Dialog recipe: Outcome Recording Modal */}
      {selectedTaskForOutcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <div
            className="fixed inset-0 bg-overlay opacity-70"
            onClick={() => setSelectedTaskForOutcome(null)}
          />
          <div className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg bg-primary shadow-2xl z-10">
            <header className="flex items-start justify-between gap-lg border-b border-secondary p-xl">
              <h2 className="text-lg font-semibold text-primary">Record Task Outcome</h2>
              <button
                type="button"
                onClick={() => setSelectedTaskForOutcome(null)}
                className="text-tertiary hover:text-primary text-sm font-semibold"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-xl flex flex-col gap-lg text-sm text-secondary">
              <div className="flex flex-col gap-xs">
                <span className="text-xs text-tertiary">Task</span>
                <p className="text-sm font-semibold text-primary">{selectedTaskForOutcome.title}</p>
                <span className="text-xs text-secondary">
                  Duration: {selectedTaskForOutcome.durationMinutes} min • Priority:{' '}
                  {selectedTaskForOutcome.priority}
                </span>
              </div>

              {/* 2. Input / Radio selection */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Actual Outcome</label>
                <div className="grid grid-cols-3 gap-sm">
                  <button
                    type="button"
                    onClick={() => setOutcomeStatus('completed')}
                    className={`inline-flex items-center justify-center gap-sm rounded-lg px-md py-sm text-sm font-semibold border shadow-xs ${
                      outcomeStatus === 'completed'
                        ? 'border-utility-success-200 bg-utility-success-50 text-utility-success-700'
                        : 'border-primary bg-primary text-secondary hover:bg-primary-hover'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 text-fg-success-primary" />
                    Completed
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutcomeStatus('postponed')}
                    className={`inline-flex items-center justify-center gap-sm rounded-lg px-md py-sm text-sm font-semibold border shadow-xs ${
                      outcomeStatus === 'postponed'
                        ? 'border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700'
                        : 'border-primary bg-primary text-secondary hover:bg-primary-hover'
                    }`}
                  >
                    <Clock className="w-4 h-4 text-fg-warning-primary" />
                    Postponed
                  </button>
                  <button
                    type="button"
                    onClick={() => setOutcomeStatus('failed')}
                    className={`inline-flex items-center justify-center gap-sm rounded-lg px-md py-sm text-sm font-semibold border shadow-xs ${
                      outcomeStatus === 'failed'
                        ? 'border-utility-error-200 bg-utility-error-50 text-utility-error-700'
                        : 'border-primary bg-primary text-secondary hover:bg-primary-hover'
                    }`}
                  >
                    <XCircle className="w-4 h-4 text-fg-error-primary" />
                    Failed
                  </button>
                </div>
              </div>

              {/* 2. Input recipe */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Why did it succeed, stall, or fail?</label>
                <textarea
                  rows={3}
                  value={outcomeFeedback}
                  onChange={e => setOutcomeFeedback(e.target.value)}
                  placeholder="e.g. Scoped cleanly, completed in 15 mins without interruptions... or ran into unexpected roadblock."
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
                <p className="text-xs text-tertiary">This explanation is stored into Walrus Memory to shape future planning policies.</p>
              </div>
            </div>

            <footer className="flex justify-end gap-sm border-t border-secondary p-xl">
              <button
                type="button"
                onClick={() => setSelectedTaskForOutcome(null)}
                className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitOutcome}
                disabled={isSubmittingOutcome}
                className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                {isSubmittingOutcome ? (
                  <RefreshCw className="w-4 h-4 text-fg-white animate-spin" />
                ) : (
                  <Check className="w-4 h-4 text-fg-white" />
                )}
                <span>Store to Walrus & Adapt</span>
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 6. Dialog recipe: Raw Blob Inspector Modal */}
      {inspectingBlobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <div
            className="fixed inset-0 bg-overlay opacity-70"
            onClick={() => setInspectingBlobId(null)}
          />
          <div className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg bg-primary shadow-2xl z-10">
            <header className="flex items-start justify-between gap-lg border-b border-secondary p-xl">
              <div className="flex items-center gap-sm">
                <Database className="w-5 h-5 text-brand-primary" />
                <h2 className="text-lg font-semibold text-primary">Walrus Blob Inspector</h2>
              </div>
              <button
                type="button"
                onClick={() => setInspectingBlobId(null)}
                className="text-tertiary hover:text-primary text-sm font-semibold"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-xl flex flex-col gap-lg text-sm text-secondary">
              <div className="flex flex-col gap-xs">
                <span className="text-xs text-tertiary">Blob Identifier</span>
                <span className="text-xs font-mono text-primary bg-secondary p-sm rounded border border-secondary select-all break-all">
                  {inspectingBlobId}
                </span>
              </div>

              <div className="flex flex-col gap-xs">
                <span className="text-xs font-medium text-secondary">Retrieved Memory Data from Aggregator</span>
                {loadingBlob ? (
                  <div className="p-xl flex items-center justify-center text-xs text-tertiary gap-sm">
                    <RefreshCw className="w-4 h-4 animate-spin text-fg-tertiary" />
                    <span>Fetching raw blob from Walrus Aggregator...</span>
                  </div>
                ) : (
                  <pre className="p-md rounded-md bg-secondary border border-secondary font-mono text-xs text-secondary overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(inspectedBlobData, null, 2)}
                  </pre>
                )}
              </div>
            </div>

            <footer className="flex justify-end gap-sm border-t border-secondary p-xl">
              <button
                type="button"
                onClick={() => setInspectingBlobId(null)}
                className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 6. Dialog recipe: Hypothesis Correction Modal */}
      {editingHypothesis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <div
            className="fixed inset-0 bg-overlay opacity-70"
            onClick={() => setEditingHypothesis(null)}
          />
          <div className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg bg-primary shadow-2xl z-10">
            <header className="flex items-start justify-between gap-lg border-b border-secondary p-xl">
              <h2 className="text-lg font-semibold text-primary">Correct Hypothesis</h2>
              <button
                type="button"
                onClick={() => setEditingHypothesis(null)}
                className="text-tertiary hover:text-primary text-sm font-semibold"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-xl flex flex-col gap-lg text-sm text-secondary">
              <div className="flex flex-col gap-xs">
                <span className="text-xs font-bold text-brand-primary">{editingHypothesis.code}</span>
                <p className="text-sm font-semibold text-primary">{editingHypothesis.title}</p>
                <p className="text-xs text-secondary">{editingHypothesis.description}</p>
              </div>

              <div className="flex flex-col gap-xs">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-secondary">Adjust Confidence</label>
                  <span className="text-sm font-semibold text-brand-primary">
                    {Math.round(correctionConfidence * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="0.99"
                  step="0.05"
                  value={correctionConfidence}
                  onChange={e => setCorrectionConfidence(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>

              {/* 2. Input recipe */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Why are you adjusting this assumption?</label>
                <textarea
                  rows={2}
                  value={correctionNote}
                  onChange={e => setCorrectionNote(e.target.value)}
                  placeholder="e.g. My working style actually accommodates longer deep work blocks in the morning."
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
              </div>
            </div>

            <footer className="flex justify-end gap-sm border-t border-secondary p-xl">
              <button
                type="button"
                onClick={() => setEditingHypothesis(null)}
                className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCorrection}
                className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Save Correction
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* 6. Dialog recipe: Manual Memory Entry Modal */}
      {showAddMemoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <div
            className="fixed inset-0 bg-overlay opacity-70"
            onClick={() => setShowAddMemoryModal(false)}
          />
          <div className="relative flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg bg-primary shadow-2xl z-10">
            <header className="flex items-start justify-between gap-lg border-b border-secondary p-xl">
              <h2 className="text-lg font-semibold text-primary">Record Experience Memory</h2>
              <button
                type="button"
                onClick={() => setShowAddMemoryModal(false)}
                className="text-tertiary hover:text-primary text-sm font-semibold"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-xl flex flex-col gap-lg text-sm text-secondary">
              {/* 2. Input recipe */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Memory Title</label>
                <input
                  type="text"
                  value={newMemTitle}
                  onChange={e => setNewMemTitle(e.target.value)}
                  placeholder="e.g. Evening context switching breakdown"
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
              </div>

              {/* 2. Input recipe */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Task Attempted</label>
                <input
                  type="text"
                  value={newMemTask}
                  onChange={e => setNewMemTask(e.target.value)}
                  placeholder="e.g. Refactor entire styling layout"
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
              </div>

              <div className="grid grid-cols-2 gap-lg">
                {/* 9. Select recipe */}
                <div className="flex flex-col gap-sm">
                  <label className="text-sm font-medium text-secondary">Outcome</label>
                  <select
                    value={newMemOutcome}
                    onChange={e => setNewMemOutcome(e.target.value as any)}
                    className="rounded-md bg-primary px-lg py-sm text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <option value="completed">Completed</option>
                    <option value="postponed">Postponed</option>
                    <option value="failed">Failed</option>
                  </select>
                </div>

                {/* 2. Input recipe */}
                <div className="flex flex-col gap-sm">
                  <label className="text-sm font-medium text-secondary">Planned Duration (m)</label>
                  <input
                    type="number"
                    value={newMemDuration}
                    onChange={e => setNewMemDuration(parseInt(e.target.value) || 25)}
                    className="rounded-md bg-primary px-lg py-sm text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                  />
                </div>
              </div>

              {/* 2. Input recipe */}
              <div className="flex flex-col gap-sm">
                <label className="text-sm font-medium text-secondary">Extracted Lesson for the Agent</label>
                <textarea
                  rows={3}
                  value={newMemLesson}
                  onChange={e => setNewMemLesson(e.target.value)}
                  placeholder="e.g. Defer refactoring tasks to dedicated fresh morning sessions."
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring"
                />
              </div>
            </div>

            <footer className="flex justify-end gap-sm border-t border-secondary p-xl">
              <button
                type="button"
                onClick={() => setShowAddMemoryModal(false)}
                className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddManualMemory}
                disabled={isStoringMemory}
                className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50"
              >
                {isStoringMemory ? (
                  <RefreshCw className="w-4 h-4 text-fg-white animate-spin" />
                ) : (
                  <PlusCircle className="w-4 h-4 text-fg-white" />
                )}
                <span>Store to Walrus</span>
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
