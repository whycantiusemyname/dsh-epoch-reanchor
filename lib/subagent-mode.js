/** Delegated-session selection shared by prompt, tool, and compaction layers. */
const MODES = new Set(['off', 'fresh', 'all']);
/** Narrow an untrusted value to the public mode vocabulary. */
export function isSubagentEpochMode(value) {
    return typeof value === 'string' && MODES.has(value);
}
/** Resolve the new mode or the backwards-compatible boolean alias. */
export function resolveSubagentEpochMode(mode, includeSubagents, owner) {
    if (mode !== undefined && includeSubagents !== undefined) {
        throw new Error(`${owner}: subagentMode and includeSubagents are mutually exclusive`);
    }
    if (mode !== undefined) {
        if (!isSubagentEpochMode(mode)) {
            throw new Error(`${owner}: subagentMode must be "off", "fresh", or "all"`);
        }
        return mode;
    }
    if (includeSubagents !== undefined && typeof includeSubagents !== 'boolean') {
        throw new Error(`${owner}: includeSubagents must be a boolean`);
    }
    return includeSubagents === true ? 'all' : 'off';
}
/** Whether this is a durable local DSH child session. */
export function isLocalSubagentSession(session) {
    return session.header.origin === 'subagent';
}
/** A local child whose model surface was not seeded from a parent transcript. */
export function isFreshLocalSubagent(session) {
    return isLocalSubagentSession(session) && (session.header.seedLength ?? 0) === 0;
}
/** Whether the configured experiment mode admits this session. Top-level sessions always do. */
export function includesSessionInEpochMode(session, mode) {
    const delegated = isLocalSubagentSession(session)
        || (session.header.delegationDepth ?? 0) > 0;
    if (!delegated)
        return true;
    if (mode === 'all')
        return true;
    return mode === 'fresh' && isFreshLocalSubagent(session);
}
//# sourceMappingURL=subagent-mode.js.map