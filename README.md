# dsh-epoch-reanchor

`dsh-epoch-reanchor` is an experimental compaction provider for DeepSeek Harness (DSH). It treats compaction as the end of one model trajectory and starts a new trajectory epoch inside the same Session using an ordinary handoff task.

Session identity, workspace, routing, raw events, UI transcript, statistics, and telemetry remain continuous. Only the model-visible message surface is replaced. The plugin does not replace the official AgentLoop or inherit a Standard-preset promotion state machine.

> [!IMPORTANT]
> This project is an experiment. No large-scale evaluation currently proves that either tail-reasoning mode is generally better or that the resulting behavior matches an undisclosed RL post-training distribution.

## Highlights

- Minimally modified from the official `dsh-compaction-basic` provider.
- Keeps official pressure measurement, retention selection, tool-pair balancing, overflow retry, pruning, and durable transaction behavior.
- Reuses the official cache-friendly summary replay strategy.
- Replaces the complete current model surface with one ordinary user-role handoff.
- Recasts the official retained tail as chronological records without evidence filtering.
- Ships two otherwise-identical A/B presets for including or removing tail reasoning.
- Leaves the official AgentLoop unchanged.
- Uses the copied official Minimal composition on POSIX.
- Marks the process-per-call Windows Git Bash implementation as degraded compatibility mode.

## How it works

```text
One DSH Session

Epoch N
  official Minimal system + tools
  append-only user / assistant / tool trajectory
        │
        │ context pressure or manual compact
        ▼
  official head/tail boundary
        ├─ older head → handoff summary
        └─ recent tail → numbered records
        │
        ▼
  replace the complete model-visible surface
        │
        ▼
Epoch N+1
  official Minimal system + tools
  one ordinary user handoff
  new append-only trajectory
```

The previous raw events are not deleted. DSH continues to use the durable log for transcript, statistics, and telemetry. The replacement changes only the surface returned to the model by Session projection.

## A/B presets

| Preset ID | `includeTailReasoning` | Retained-tail behavior |
|---|---:|---|
| `epoch-reanchor-no-reasoning` | `false` | Removes assistant reasoning blocks |
| `epoch-reanchor-with-reasoning` | `true` | Includes reasoning under `Reasoning:` records |

The two `agent.cordis.yml` files are tested to be identical except for this Boolean value.

The retained tail is selected by the official token-budget algorithm, not by a fixed message count. User input, plugin context, assistant text, tool calls, tool results, errors, and image attachments retain their selected membership, order, and content. Only message roles and provider tool-protocol structure are flattened into ordinary records.

## Model-visible restart

The first request of a new epoch contains:

```text
System: You are a helpful software engineer assistant.
Tools:  bash + str_replace_editor
User:   earlier task state + recent interaction records
```

It does not continue the old assistant/tool-role trajectory and does not add `<compacted-summary>`, compaction identifiers, Standard tools, runtime snapshots, AGENTS/CLAUDE digests, or skill-catalog injections.

The durable replacement still uses the official `compactCheckpointSource(compactionId)` for compaction and UI correlation. Message source metadata is not model content.

## KV-cache behavior

History remains append-only within each epoch. The summary request replays the old system, tools, and summarized head before appending a fixed compaction instruction, matching the official cache-replay design.

After the epoch boundary, the first history message differs because the surface has been replaced. Under ordinary prefix caching, the old conversation tail cannot reuse its previous KV state; the stable system/tools prefix may still be reusable. Official checkpoint compaction also diverges near the beginning of history, so the additional cache difference is concentrated at the boundary rather than every step.

Actual cache hits, lifetime, and pricing are provider-controlled and must be measured through adapter telemetry when available.

## Install

Requirements:

- Node.js `^22.19.0` or `>=24`;
- DeepSeek Harness `0.1.0-rc.6` APIs;
- a target profile containing the official base bundle and agent-preset roster.

Install from GitHub into the `web` profile:

```powershell
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

Replace `web` with the profile you use. pnpm may print peer-dependency warnings for official DSH packages supplied by the Harness installation fallback; the public GitHub installation path is covered by a loader smoke test.

The bundle patch is intentionally empty. Installing the bundle only makes the package resolvable from the profile. Each agent preset mounts its own isolated compaction provider, so no process-global AgentLoop or compaction provider is installed.

Install from a local checkout:

```powershell
git clone https://github.com/whycantiusemyname/dsh-epoch-reanchor.git
cd dsh-epoch-reanchor
npm install
npm run build
dsh plugin --profile web add .
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

Restart DSH, create a blank Session, and select one of the two Epoch Re-anchor presets. Do not switch a Session that has already produced messages between presets.

## Management

```text
dsh plugin --profile web exec dsh-epoch-reanchor status
dsh plugin --profile web exec dsh-epoch-reanchor paths
```

Uninstall:

```text
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web remove dsh-epoch-reanchor
```

Sessions that depend on these presets may no longer recompose after removal. Keep the package and preset directories while those Sessions still need to resume.

## Default configuration

```yaml
- id: epoch-compaction
  name: dsh-epoch-reanchor
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    includeTailReasoning: false # or true
    includeSubagents: false
    auto: true
```

The provider also retains the official `retainTokens`, summary route, generation cap, retry, overflow retry, and exact-model policy fields.

For a clean A/B test, keep model, provider, reasoning effort, repository state, task, threshold, retention budget, summary route, and permission mode fixed. Use a fresh Session for each preset.

## Platform behavior

POSIX uses the copied official persistent PTY Bash and bare `fs-local` editor composition.

Windows uses a process-per-call Git Bash compatibility tool. Its model-visible name remains `bash`, but shell state is not persistent across calls. Windows results must not be reported as an exact reproduction of the POSIX Minimal runtime. Change `windows-bash.config.bashPath` if Git Bash is not installed at:

```text
C:\Program Files\Git\bin\bash.exe
```

## Failure behavior

- A failed summary does not replace the current surface.
- The durable transaction records a failed `compaction/end`.
- Pressure-compaction failure allows the current turn to continue.
- Overflow recovery retries only after durable surface progress.
- A replacement that is not smaller than the shadowed content is rejected.
- Delegated subagents skip automatic epoch compaction by default.

## Verification

```text
npm test
npm pack --dry-run
```

Tests cover the official retained-tail cutoff, complete-surface replacement, both reasoning modes, tool-call/result recasting, repeated compaction, Session continuity, default subagent exclusion, summary failure, single-variable preset parity, and the absence of a global AgentLoop or compaction installation.

The published repository has also been smoke-tested through real `dsh plugin ... add github:` installation, CLI preset management, packed-package installation, and both preset compositions in the real DSH Loader.

## Limitations

- No large-scale benchmark establishes the better tail-reasoning mode.
- Role flattening does not remove semantic or stylistic influence from retained text.
- History compaction cannot fix an oversized indivisible surface node, system prompt, or tool-schema envelope.
- Overflow recovery still requires the provider to accept the summary request.
- Windows compatibility mode is not persistent Bash.
- DSH is a developer preview; review the official compaction diff and Minimal composition after upgrades.

## Sources and attribution

Official baseline: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `47f943859bef60e4160492346772ded9b24f765a`, especially `dsh-compaction-basic`, `dsh-compaction`, Session projection, and the official Minimal preset. See the [DSH development guide](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) and [Cordis tutorial](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/).

Community experiment reference: [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard), including its experimental presets studying model-visible system/tool composition, first-request trajectory, and the official Minimal interface.

This repository is not a branch of that community project, contains no copied community code, and does not target a PR to it. See [NOTICE](./NOTICE) for the official MIT attribution.

## License

MIT
