/**
 * Fresh local Subagent projection: keep the Minimal system envelope fixed and
 * move any child-specific persona into the durable user task for every epoch.
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SubagentEpochMode } from './types.ts';
/** The official Minimal persona used by the bundled JSON-RPC example. */
export declare const MINIMAL_PERSONA = "You are a helpful software engineer assistant.";
/** Visible footer used for task-specific child role guidance. */
export declare const ROLE_GUIDANCE_HEADING = "Role guidance for this delegated task:";
/** Model-hidden durable agent-level state, independent from any one epoch surface. */
export interface DeferredAgentContext {
    readonly version: 1;
    readonly persona: string;
}
declare module '@deepseek-ai/dsh-session' {
    interface SessionEventMap {
        /** Resolved child persona reprojected into every model-visible epoch task. */
        'epoch-reanchor/agent-context': DeferredAgentContext;
    }
}
export declare const name = "subagent-epoch";
export declare const inject: never[];
export interface Config {
    /** Delegated sessions whose system and user-task projection is rewritten. */
    mode?: SubagentEpochMode;
}
export declare const Config: z<Config>;
/** Stable footer appended to the ordinary user task or handoff. */
export declare function deferredPersonaFooter(persona: string): string;
/** Fold the latest plugin-owned agent context from this child's own log suffix. */
export declare function deferredPersonaOf(session: Session): string | undefined;
/** Remove the exact plugin-owned footer before recasting a retained message as a recent record. */
export declare function stripDeferredPersonaFooter(content: readonly ContentBlock[], persona: string | undefined): ContentBlock[];
/**
 * Install the child-only projection. The assembly waterfall runs before
 * `agent/pre-step`; the latter's returned messages are then durably appended by
 * the official AgentLoop, so the projected task remains replayable for cache-aligned compaction.
 */
export declare function apply(ctx: Context, config?: Config): void;
export default apply;
//# sourceMappingURL=subagent-epoch.d.ts.map