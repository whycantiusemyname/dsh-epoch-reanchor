/**
 * Keep the first request of every top-level trajectory epoch on the official
 * Minimal tool pair. The first durable tool call opens the complete catalog
 * assembled by the preset. A successful compaction starts a new gated epoch.
 */

export const name = 'epoch-tool-bootstrap'
export const inject = []

const DEFAULT_BOOTSTRAP_TOOLS = ['bash', 'str_replace_editor']
const DEFAULT_SUPPRESSED_SOURCES = ['agent-instructions', 'skill-catalog']
const ALLOWED_KEYS = new Set(['bootstrapTools', 'suppressedContextSources', 'includeSubagents'])

function nonEmptyStrings(value, field, fallback, allowEmpty = false) {
  if (value === undefined) return [...fallback]
  if (!Array.isArray(value)
    || (!allowEmpty && value.length === 0)
    || value.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${name}: ${field} must be ${allowEmpty ? 'an' : 'a non-empty'} array of non-empty strings`)
  }
  return [...new Set(value)]
}

function successfulBoundary(event) {
  return event?.type === 'compaction/end' && event.data?.error === undefined
}

function foldPromotion(events) {
  let promoted = false
  if (!Array.isArray(events)) return promoted
  for (const event of events) {
    if (successfulBoundary(event)) {
      promoted = false
      continue
    }
    if (event?.type === 'tool/call') promoted = true
  }
  return promoted
}

function createPromotionTracker(includeSubagents) {
  const states = new WeakMap()

  const sessionFor = (agent) => {
    const session = agent?.session
    if (session === undefined || session === null || typeof session !== 'object') return undefined
    if (!includeSubagents && (session.header?.delegationDepth ?? 0) > 0) return undefined
    return session
  }

  return {
    promoted(agent) {
      const session = sessionFor(agent)
      if (session === undefined) return true
      const cached = states.get(session)
      if (cached !== undefined) return cached
      const promoted = foldPromotion(session.events)
      states.set(session, promoted)
      return promoted
    },
    observe(session, event) {
      if (session === undefined || session === null || typeof session !== 'object') return
      if (!includeSubagents && (session.header?.delegationDepth ?? 0) > 0) return
      if (!states.has(session)) return
      if (successfulBoundary(event)) {
        states.set(session, false)
      } else if (event?.type === 'tool/call') {
        states.set(session, true)
      }
    },
  }
}

export function apply(ctx, config) {
  const source = config ?? {}
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError(`${name}: config must be an object`)
  }
  const unknown = Object.keys(source).filter(key => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) throw new TypeError(`${name}: unknown config key(s): ${unknown.join(', ')}`)
  if (source.includeSubagents !== undefined && typeof source.includeSubagents !== 'boolean') {
    throw new TypeError(`${name}: includeSubagents must be a boolean`)
  }

  const bootstrapTools = nonEmptyStrings(
    source.bootstrapTools,
    'bootstrapTools',
    DEFAULT_BOOTSTRAP_TOOLS,
  )
  const suppressedSources = new Set(nonEmptyStrings(
    source.suppressedContextSources,
    'suppressedContextSources',
    DEFAULT_SUPPRESSED_SOURCES,
    true,
  ))
  const promotion = createPromotionTracker(source.includeSubagents === true)
  ctx.on('session/event', (session, event) => promotion.observe(session, event))

  let warned = false
  const warnOnce = (message) => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // A missing logger must not affect request assembly.
    }
  }

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    try {
      if (promotion.promoted(context.agent)) return assembled
      const available = new Set(assembled.tools.map(tool => tool.name))
      const missing = bootstrapTools.filter(toolName => !available.has(toolName))
      if (missing.length > 0) {
        warnOnce(`${name}: missing bootstrap tools ${JSON.stringify(missing)}; exposing the full catalog`)
        return assembled
      }
      const keep = new Set(bootstrapTools)
      return { ...assembled, tools: assembled.tools.filter(tool => keep.has(tool.name)) }
    } catch (error) {
      warnOnce(`${name}: tool filtering failed; exposing the full catalog: ${String(error)}`)
      return assembled
    }
  })

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || suppressedSources.size === 0) return decision
    try {
      if (promotion.promoted(agent) || !Array.isArray(decision.messages)) return decision
      const messages = decision.messages.filter((message) => {
        const sourceKind = message?.source?.kind
        return typeof sourceKind !== 'string' || !suppressedSources.has(sourceKind)
      })
      return messages.length === decision.messages.length ? decision : { ...decision, messages }
    } catch (error) {
      warnOnce(`${name}: context filtering failed; keeping injected context: ${String(error)}`)
      return decision
    }
  }, { prepend: true })
}
