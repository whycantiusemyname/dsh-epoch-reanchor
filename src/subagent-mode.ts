/** Delegated-session selection shared by prompt, tool, and compaction layers. */

import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentEpochMode } from './types.ts'

const MODES = new Set<SubagentEpochMode>(['off', 'fresh', 'all'])

/** Narrow an untrusted value to the public mode vocabulary. */
export function isSubagentEpochMode(value: unknown): value is SubagentEpochMode {
  return typeof value === 'string' && MODES.has(value as SubagentEpochMode)
}

/** Resolve the new mode or the backwards-compatible boolean alias. */
export function resolveSubagentEpochMode(
  mode: unknown,
  includeSubagents: unknown,
  owner: string,
): SubagentEpochMode {
  if (mode !== undefined && includeSubagents !== undefined) {
    throw new Error(`${owner}: subagentMode and includeSubagents are mutually exclusive`)
  }
  if (mode !== undefined) {
    if (!isSubagentEpochMode(mode)) {
      throw new Error(`${owner}: subagentMode must be "off", "fresh", or "all"`)
    }
    return mode
  }
  if (includeSubagents !== undefined && typeof includeSubagents !== 'boolean') {
    throw new Error(`${owner}: includeSubagents must be a boolean`)
  }
  return includeSubagents === true ? 'all' : 'off'
}

/** Whether this is a durable local DSH child session. */
export function isLocalSubagentSession(session: Pick<Session, 'header'>): boolean {
  return session.header.origin === 'subagent'
}

/** A local child whose model surface was not seeded from a parent transcript. */
export function isFreshLocalSubagent(session: Pick<Session, 'header'>): boolean {
  return isLocalSubagentSession(session) && (session.header.seedLength ?? 0) === 0
}

/** Whether the configured experiment mode admits this session. Top-level sessions always do. */
export function includesSessionInEpochMode(
  session: Pick<Session, 'header'>,
  mode: SubagentEpochMode,
): boolean {
  const delegated = isLocalSubagentSession(session)
    || (session.header.delegationDepth ?? 0) > 0
  if (!delegated) return true
  if (mode === 'all') return true
  return mode === 'fresh' && isFreshLocalSubagent(session)
}
