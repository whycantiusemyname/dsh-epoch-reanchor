**English** | [中文](./README.md)

# dsh-epoch-reanchor

`dsh-epoch-reanchor` is an experimental DeepSeek Harness (DSH) plugin. After compaction, it ends the old model trajectory and starts a new epoch inside the same Session using an ordinary handoff task.

Session identity, workspace, raw events, and UI history remain continuous. Only the model-visible message history is rebuilt. The official AgentLoop is not replaced.

> [!IMPORTANT]
> This project is intended for A/B testing. No large-scale evaluation currently proves that either mode is generally better or that it reproduces an undisclosed RL post-training distribution.

## How it works

```text
Epoch N
  official Minimal system + tools
  append-only trajectory
        │
        │ compaction
        ▼
  older head → handoff summary
  recent tail → numbered records
        │
        ▼
  replace the complete model-visible surface
        │
        ▼
Epoch N+1
  official Minimal system + tools
  one ordinary user handoff
```

The plugin keeps the official pressure threshold, tail selection, token meter, tool-pair boundary, cache-replay summary, and failure rollback. It changes only the final replacement so the new epoch does not inherit the old assistant/tool-role trajectory.

The new epoch starts with:

```text
System: You are a helpful software engineer assistant.
Tools:  bash + str_replace_editor
User:   earlier task state + recent interaction records
```

It does not add `<compacted-summary>`, internal compaction details, Standard tools, runtime snapshots, AGENTS digests, or skill-catalog injections.

## A/B presets

| Preset | Tail reasoning |
|---|---|
| `epoch-reanchor-no-reasoning` | Removes assistant reasoning blocks |
| `epoch-reanchor-with-reasoning` | Keeps reasoning under `Reasoning:` records |

The two presets are identical except for `includeTailReasoning`.

The recent tail is still selected by the official token-budget algorithm. User messages, visible assistant text, tool calls/results, errors, and images keep their order and are mechanically converted into ordinary numbered records.

## Install

Requirements:

- Node.js `^22.19.0` or `>=24`;
- DeepSeek Harness `0.1.0-rc.6`.

Install into the `web` profile:

```powershell
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

Replace `web` with another profile name when needed. The package must be installed into every profile that will use the presets; the preset directories themselves live under the shared `$DSH_HOME/.agent-presets` root.

pnpm may report peer-dependency warnings for official packages supplied through the DSH installation fallback. The loader path has been smoke-tested.

## Use

1. Fully restart DSH.
2. Create a blank Session.
3. Select one Epoch Re-anchor preset.
4. Keep that Session on the same preset.

Do not switch an active Session between presets.

```text
dsh plugin --profile web exec dsh-epoch-reanchor status
dsh plugin --profile web exec dsh-epoch-reanchor paths
```

Uninstall:

```text
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web remove dsh-epoch-reanchor
```

Keep the package and presets while existing Sessions still need to resume.

## KV cache

History remains append-only within an epoch. The summary request reuses the old system, tools, and older-head prefix before appending a fixed compaction instruction.

At the epoch boundary, history diverges near the beginning, so the old tail KV cannot continue directly; the stable system/tools prefix may still be reusable. Actual cache hits, lifetime, and pricing are provider-controlled.

## Platforms

- **Linux/macOS:** copied official Minimal persistent PTY Bash and bare `fs-local` editor composition.
- **Windows:** process-per-call Git Bash compatibility tool. Shell state is not persistent, so this is a degraded mode.

Default Windows path:

```text
C:\Program Files\Git\bin\bash.exe
```

Change `windows-bash.config.bashPath` when Git Bash is installed elsewhere.

## A/B guidance

Use a fresh Session for each mode and keep the model, reasoning effort, task, repository state, permissions, and compaction settings fixed. Compare repeated exploration, tool use, recovery from recent errors, token/cache usage, and final task quality.

## Verification

```text
npm test
npm pack --dry-run
```

Tests cover full-surface replacement, the official tail boundary, reasoning A/B, tool-record conversion, repeated compaction, failure rollback, default subagent exclusion, and single-variable preset parity.

## Limitations

- The better tail-reasoning mode is not established.
- Role flattening does not remove semantic influence from retained text.
- Windows compatibility mode is not persistent Bash.
- DSH is a developer preview; recheck APIs and preset composition after upgrades.

## Sources

Official baseline: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `47f943859bef60e4160492346772ded9b24f765a`, especially the official Minimal preset, `dsh-compaction-basic`, the compaction service, and Session projection.

Community experiment reference: [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) and its experimental presets studying model-visible system/tool composition, first-request trajectory, and the official Minimal interface.

This project is not a branch of that repository and contains no copied community code. See [NOTICE](./NOTICE) for official MIT attribution.

## License

MIT
