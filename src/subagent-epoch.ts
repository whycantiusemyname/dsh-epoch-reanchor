/**
 * Fresh local Subagent projection: keep the Minimal system envelope fixed and
 * move any child-specific persona into the durable user task for every epoch.
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import {
  PERSONA_SECTION,
  renderPrompt,
} from '@deepseek-ai/dsh-system-prompt'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import {
  includesSessionInEpochMode,
  isLocalSubagentSession,
  isSubagentEpochMode,
} from './subagent-mode.ts'
import type { SubagentEpochMode } from './types.ts'

/** The official Minimal persona used by the bundled JSON-RPC example. */
export const MINIMAL_PERSONA = 'You are a helpful software engineer assistant.'

/** Visible footer used for task-specific child role guidance. */
export const ROLE_GUIDANCE_HEADING = 'Role guidance for this delegated task:'

/** Model-hidden durable agent-level state, independent from any one epoch surface. */
export interface DeferredAgentContext {
  readonly version: 1
  readonly persona: string
}

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /** Resolved child persona reprojected into every model-visible epoch task. */
    'epoch-reanchor/agent-context': DeferredAgentContext
  }
}

export const name = 'subagent-epoch'
export const inject = []

export interface Config {
  /** Delegated sessions whose system and user-task projection is rewritten. */
  mode?: SubagentEpochMode
}

export const Config: z<Config> = z.object({
  mode: z.union(['off', 'fresh', 'all'] as const).default('fresh'),
})

/** Stable footer appended to the ordinary user task or handoff. */
export function deferredPersonaFooter(persona: string): string {
  return `\n\n${ROLE_GUIDANCE_HEADING}\n${persona}`
}

/** Fold the latest plugin-owned agent context from this child's own log suffix. */
export function deferredPersonaOf(session: Session): string | undefined {
  const ownStart = session.header.seedLength ?? 0
  for (let index = session.events.length - 1; index >= ownStart; index -= 1) {
    const event = session.events[index]
    if (event?.type === 'epoch-reanchor/agent-context') return event.data.persona
  }
  return undefined
}

/** Remove the exact plugin-owned footer before recasting a retained message as a recent record. */
export function stripDeferredPersonaFooter(
  content: readonly ContentBlock[],
  persona: string | undefined,
): ContentBlock[] {
  if (persona === undefined) return [...content]
  const footer = deferredPersonaFooter(persona)
  const output = [...content]
  const last = output.at(-1)
  if (last?.type !== 'text' || !last.text.endsWith(footer)) return output
  const text = last.text.slice(0, -footer.length)
  if (text.length === 0) output.pop()
  else output[output.length - 1] = { type: 'text', text }
  return output
}

/** Resolve just the effective persona section with the official strict variable semantics. */
function childPersona(assembly: PromptAssembly): string | undefined {
  const section = assembly.sections.find(entry => entry.name === PERSONA_SECTION)
  if (section === undefined) return undefined
  const rendered = renderPrompt({ ...assembly, sections: [section], contexts: [] })
  return rendered.length === 0 || rendered === MINIMAL_PERSONA ? undefined : rendered
}

function withPersona(message: UserMessage, persona: string): UserMessage {
  const content = [...message.content]
  const footer = deferredPersonaFooter(persona)
  const last = content.at(-1)
  if (last?.type === 'text') {
    content[content.length - 1] = { type: 'text', text: last.text + footer }
  } else {
    content.push({ type: 'text', text: footer })
  }
  return { ...message, content }
}

function taskMessageIndex(messages: readonly UserMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.source.kind === 'user') return index
  }
  return messages.length - 1
}

function eligibleChild(agent: Agent, mode: SubagentEpochMode): boolean {
  return isLocalSubagentSession(agent.session)
    && includesSessionInEpochMode(agent.session, mode)
}

/**
 * Install the child-only projection. The assembly waterfall runs before
 * `agent/pre-step`; the latter's returned messages are then durably appended by
 * the official AgentLoop, so the projected task remains replayable for cache-aligned compaction.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const mode = config.mode ?? 'fresh'
  if (!isSubagentEpochMode(mode)) {
    throw new TypeError(`${name}: mode must be "off", "fresh", or "all"`)
  }
  const pendingPersona = new WeakMap<Session, string | null>()

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembled = await next()
    const agent = context.agent
    if (agent === undefined || !eligibleChild(agent, mode)) return assembled

    const persisted = deferredPersonaOf(agent.session)
    pendingPersona.set(agent.session, persisted ?? childPersona(assembled) ?? null)
    return {
      ...assembled,
      sections: [{ name: PERSONA_SECTION, text: MINIMAL_PERSONA }],
      contexts: [],
    }
  })

  ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject'
      || !eligibleChild(agent, mode)
      || agent.session.surface.nodes.length > 0
      || decision.messages.length === 0) return decision

    const persisted = deferredPersonaOf(agent.session)
    const persona = persisted ?? pendingPersona.get(agent.session) ?? undefined
    if (persona === undefined) return decision
    if (persisted === undefined) {
      agent.session.append('epoch-reanchor/agent-context', { version: 1, persona })
    }

    const index = taskMessageIndex(decision.messages)
    const target = decision.messages[index]
    if (target === undefined) return decision
    const messages = [...decision.messages]
    messages[index] = withPersona(target, persona)
    return { ...decision, messages }
  })
}

export default apply
