**English** | [中文](./README.md)

# dsh-epoch-reanchor

`dsh-epoch-reanchor` is an experimental DeepSeek Harness (DSH) plugin for testing an unproven observation: after context compaction, do the summary and retained trajectory affect whether the model re-enters a chain of thought with visible `We ...` and `Let's ...` traits (called “`We/Let's` traits” below)?

At the compaction boundary, the plugin ends the old model-visible trajectory, recasts the required work state as an ordinary user handoff, and starts a new epoch with the official Minimal system and two-tool surface. After the epoch makes its first real tool call, the next step exposes the complete Standard tool catalog. This minimizes prior-trajectory conditioning without restricting the whole task to two tools.

Apart from rebuilding model-visible history, the plugin tries to preserve the official repository's verifiable environment traits throughout the task: the Minimal system, platform shell/editor bootstrap, Standard tool surface after the first tool call, and the official compaction pressure, tail, and cache-replay behavior. It does not claim exact semantics that the host platform cannot provide.

Local children that do not inherit a parent transcript use the same epoch rules. When a child has a custom persona, the plugin keeps its system Minimal and deterministically places that persona at the end of the ordinary user task/handoff. Model-hidden agent state restores it after every compaction.

Session identity, workspace, raw events, and UI history remain continuous. Only the model-visible message history is rebuilt. The official AgentLoop is not replaced.

> [!IMPORTANT]
> `We/Let's` phrases are observable textual traits, not a description of the model's complete internal mechanism. They do not by themselves prove reasoning quality or proximity to an RL post-training distribution. This project is intended for A/B testing, and no large-scale evaluation currently proves that either mode is generally better.

## How it works

```text
Epoch N
  Minimal system + platform shell/editor
  first tool call → full Standard tools
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
  Minimal system + platform shell/editor
  one ordinary user handoff
  first tool call → full Standard tools
```

The plugin keeps the official pressure threshold, tail selection, token meter, tool-pair boundary, cache-replay summary, and failure rollback. It changes only the final replacement so the new epoch does not inherit the old assistant/tool-role trajectory.

The new epoch starts with:

```text
System: You are a helpful software engineer assistant.
Tools:  Linux/macOS: bash + str_replace_editor
        Windows:     pwsh + str_replace_editor (default)
                     bash + str_replace_editor (optional Git Bash)
User:   earlier task state + recent interaction records
```

After the first durable `tool/call`, the next request exposes the official Standard preset's tool catalog. A successful compaction closes the gate again. Automatic AGENTS digests and the skill catalog are suppressed on the bootstrap request and restored after promotion; `<compacted-summary>`, internal compaction details, and runtime snapshots are never injected.

### Subagent boundary

- A fresh local child (normally `spawn`) starts with the Minimal system and platform tool pair, then promotes only to tools allowed by its `toolFilter`.
- A custom persona becomes a lower-priority user-role task condition instead of a system instruction. This is an intentional experimental variable, not equivalent to official persona semantics.
- If `toolFilter` removes either required bootstrap tool, the experimental child fails loudly rather than silently producing an unaligned trajectory.
- Seeded `fork` children and external Codex, Claude Code, or ACP providers retain official behavior and are outside the fresh-epoch comparison.

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

To upgrade an existing installation, remove the copied presets before updating and reinstalling them:

```powershell
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

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

After the first tool call, history remains append-only and the full Standard tool schema stays stable for the rest of the epoch. The summary request reuses the old system, tools, and older-head prefix before appending a fixed compaction instruction.

Each epoch deliberately changes the prefix twice: the boundary switches to the Minimal pair, then the first tool call switches to the full Standard catalog. Both transitions limit direct reuse of the previous KV tail; the prefix can grow stably again until the next compaction. Actual cache hits, lifetime, and pricing are provider-controlled.

## Platforms

- **Linux/macOS:** official persistent PTY Bash with `str_replace_editor`, providing the closest match to the official Minimal RL interface.
- **Native Windows, default:** follows the official DSH platform composition and uses `pwsh` with `str_replace_editor`. It is reliable, but its schema and execution semantics are not equivalent to Linux Bash.
- **Native Windows, optional:** set `windowsShell` to `git-bash` in the `dsh-epoch-reanchor` section of `$DSH_HOME/settings.yaml`. This exposes `bash` with `str_replace_editor` and retains the official persistent Bash tool's single `command` parameter shape, but starts a fresh Git Bash process for every call.

The equivalent `$DSH_HOME/settings.yaml` section is:

```yaml
dsh-epoch-reanchor:
  windowsShell: git-bash
  gitBashPath: 'C:\Program Files\Git\bin\bash.exe'
```

`gitBashPath` defaults to `bash` and is resolved through `PATH`. These settings apply after a full DSH restart. Git Bash is only a syntax-compatibility experiment backend; it does not reproduce Linux persistent Bash cwd, environment, user-space, or process semantics. Use Linux, WSL2, or a Linux container when strict RL shell-interface control matters.

In DSH `0.1.0-rc.6`, the Web Settings form exposes only namespaces on the official allowlist, so the third-party `dsh-epoch-reanchor` section must currently be edited in `settings.yaml`.

## A/B guidance

Use a fresh Session for each mode and keep the model, reasoning effort, task, repository state, permissions, and compaction settings fixed. Compare post-compaction `We/Let's` traits, the first tool call, behavior after the full catalog opens, token/cache usage, and final task quality.

## Verification

```text
npm test
npm pack --dry-run
```

Tests also cover fresh-child Minimal systems, deferred persona restoration across epochs, independent tool gates, `toolFilter` failure, fork isolation, and single-variable preset parity.

## Limitations

- The better tail-reasoning mode is not established.
- If the model never calls a tool, that epoch remains on the two-tool surface.
- Whether opening the full Standard catalog changes `We/Let's` traits requires testing.
- Role flattening does not remove semantic influence from retained text.
- A user-role persona may be followed less strongly than the official system persona.
- Forked and external providers are outside the fresh Subagent Epoch experiment.
- Native Windows `pwsh` mode is not Linux persistent Bash.
- Optional Git Bash mode starts a fresh process per call and is not Linux persistent Bash either.
- DSH is a developer preview; recheck APIs and preset composition after upgrades.

## Sources

Official baseline: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `47f943859bef60e4160492346772ded9b24f765a`, especially the official Minimal/Standard presets, `dsh-compaction-basic`, the compaction service, and Session projection.

Community experiment reference: [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) and its experimental presets studying model-visible system/tool composition, first-request trajectory, and the official Minimal interface.

This project is not a branch of that repository and contains no copied community code. See [NOTICE](./NOTICE) for official MIT attribution.

## License

MIT
