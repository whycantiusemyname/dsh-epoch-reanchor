/** Delegated-session selection shared by prompt, tool, and compaction layers. */
import type { Session } from '@deepseek-ai/dsh-session';
import type { SubagentEpochMode } from './types.ts';
/** Narrow an untrusted value to the public mode vocabulary. */
export declare function isSubagentEpochMode(value: unknown): value is SubagentEpochMode;
/** Resolve the new mode or the backwards-compatible boolean alias. */
export declare function resolveSubagentEpochMode(mode: unknown, includeSubagents: unknown, owner: string): SubagentEpochMode;
/** Whether this is a durable local DSH child session. */
export declare function isLocalSubagentSession(session: Pick<Session, 'header'>): boolean;
/** A local child whose model surface was not seeded from a parent transcript. */
export declare function isFreshLocalSubagent(session: Pick<Session, 'header'>): boolean;
/** Whether the configured experiment mode admits this session. Top-level sessions always do. */
export declare function includesSessionInEpochMode(session: Pick<Session, 'header'>, mode: SubagentEpochMode): boolean;
//# sourceMappingURL=subagent-mode.d.ts.map