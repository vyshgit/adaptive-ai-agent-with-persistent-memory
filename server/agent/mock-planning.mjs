// A deterministic UI demonstration, not an intent classifier or a travel API.
// Live models receive the memory-first prompt and make their own bounded calls.
const tripRequest = /\b(?:plan|planning|outline|organize|arrange)\b[\s\S]*\b(?:trip|travel|itinerary|holiday|vacation|getaway)\b/i
const tripQuestion = /Which city will you depart from for this trip|What dates and length should this trip cover/
const banner = 'Mock model — deterministic offline demo, not a live LLM.\n\n'

function departure(text) {
  const statements = text.split(/[.!?\n]+/).filter(statement => !/\b(if|suppose|maybe|might|pretend|example|guess)\b/i.test(statement))
  const statement = statements.findLast(statement => /\b(?:I (?:usually |normally |now )?(?:depart|fly|leave|travel) from|my departure (?:city|airport) is)\s+/i.test(statement))
  const match = statement?.match(/\b(?:I (?:usually |normally |now )?(?:depart|fly|leave|travel) from|my departure (?:city|airport) is)\s+([^;\n]{1,80})/i)
  const city = match?.[1].split(/,|\s+and\s+/i)[0].trim()
  return city && !/\b(where|somewhere|unknown|not sure)\b/i.test(city) ? { city, correction: /\b(actually|correction|instead|now)\b/i.test(statement) } : null
}

function originContext(users, memories) {
  for (const user of [...users].reverse()) {
    const stated = departure(user.content)
    if (stated) return { city: stated.city, source: 'your reply' }
  }
  const saved = memories.filter(memory => ['facts', 'profile'].includes(memory.tier))
    .map(memory => ({ ...departure(memory.text), memory })).filter(item => item.city)
    .sort((a, b) => (b.memory.createdAt || '').localeCompare(a.memory.createdAt || ''))
  const cities = [...new Set(saved.map(item => item.city))]
  if (cities.length === 1 || (saved[0]?.correction && saved[0].memory.createdAt
    && saved.every(item => item.memory.createdAt && item.memory.createdAt <= saved[0].memory.createdAt))) {
    return { city: saved[0].city, source: `saved context [${saved[0].memory.blobId}]` }
  }
  return { conflict: cities.length > 1, cities }
}

export function mockTripTurn({ messages, memories = [], tools = [] }) {
  const users = messages.filter(message => message.role === 'user')
  const task = users.at(-1)?.content || ''
  const previousAssistant = messages.findLast(message => message.role === 'assistant' && message.content?.trim())?.content || ''
  if (!tripRequest.test(task) && !(tripQuestion.test(previousAssistant) && users.some(user => tripRequest.test(user.content)))) return null
  const toolMessages = messages.filter(message => message.role === 'tool')
  const enabled = name => tools.some(tool => tool.function.name === name)
  if (!toolMessages.length && enabled('plan_task')) return [
    { type: 'tool_call', id: 'mock-trip-plan', name: 'plan_task', args: { summary: 'A short trip, shaped by your context',
      steps: ['Confirm the departure city and timing.', 'Use relevant travel preferences to outline a manageable trip.', 'Verify routes, fares, weather, and availability with current sources before any booking.'] } },
    { type: 'finish', reason: 'tool_calls' },
  ]
  const origin = originContext(users, memories)
  const timing = [...users].reverse().find(user => /\b(?:next|this) weekend\b|\b\d{1,2}\s+(?:days|nights)\b|flexible on dates/i.test(user.content))?.content
  const unavailable = messages[0]?.content.includes('Some memory lookups were unavailable.')
  const question = !origin.city ? { question: 'Which city will you depart from for this trip?',
    why: unavailable ? 'Prior memory could not be fully checked. Please confirm the departure city; I will not guess.'
      : origin.conflict ? 'Saved departure cities conflict and no clear correction resolves them. Please confirm which applies to this trip.'
        : 'I checked recalled context but do not have a confirmed departure city for this trip. A home city alone is not enough.',
    options: (origin.cities || []).slice(0, 4).map(city => `I depart from ${city}.`) }
    : !timing ? { question: 'What dates and length should this trip cover?', why: `I can use ${origin.city} from ${origin.source}. Timing still needs your confirmation.`,
      options: ['Next weekend, for 3 days.', 'I’m flexible on dates.'] } : null
  if (question) return enabled('ask_user') ? [
    { type: 'delta', text: banner },
    { type: 'tool_call', id: 'mock-trip-question', name: 'ask_user', args: question },
    { type: 'finish', reason: 'tool_calls' },
  ] : [{ type: 'delta', text: `${banner}${question.why}\n\n${question.question}` }, { type: 'finish', reason: 'stop' }]
  return [{ type: 'delta', text: `${banner}Departure: **${origin.city}**, from ${origin.source}. Your timing reply: ${timing}\n\n## Draft approach\n- Allow for travel time before choosing the length and destination within the trip.\n- Keep one main activity per day, leaving room for arrival and the return journey.\n- Confirm the budget and check current routes, fares, weather, and availability before committing.\n\nThis is a scripted planning outline, not verified travel advice. No live travel facts were checked, no booking was made, and no code was proposed.` },
  { type: 'finish', reason: 'stop' }]
}
