# dsh-epoch-reanchor

An independent experimental DeepSeek Harness plugin that turns compaction into a fresh model conversation while keeping the same Session, raw event log, UI transcript, routing, and workspace.

It does **not** replace AgentLoop. The provider is copied from the official `dsh-compaction-basic` implementation and minimally changed so that:

1. the official pressure and retained-tail split is preserved;
2. the older head is summarized with the official cache-replay strategy;
3. the official retained tail is mechanically recast as numbered user-provided records;
4. the complete current surface is replaced by one ordinary user handoff;
5. the next request starts with the official Minimal system and two-tool composition.

## A/B presets

| Preset | Tail reasoning |
|---|---|
| `epoch-reanchor-no-reasoning` | Removed from the recast tail |
| `epoch-reanchor-with-reasoning` | Included under `Reasoning:` records |

The two copied Minimal preset files are tested to be identical except for `includeTailReasoning`.

## Model-visible result

```text
System: You are a helpful software engineer assistant.
Tools:  persistent bash + str_replace_editor
User:   earlier task state + recent interaction records
```

No `<compacted-summary>` framing, raw assistant/tool tail, Standard tool catalog, runtime snapshot, AGENTS digest, or skill catalog is added.

The replacement retains the official `compactCheckpointSource(compactionId)` internally for durable correlation and existing UI presentation. Message source metadata is not sent to the model.

## Cache behavior

Within an epoch, history remains append-only. The handoff request replays the old system, tools, and summarized head before appending the compaction instruction, matching the official cache-friendly design.

After official compaction, the conversation already diverges at the first replaced history token, so a retained raw tail normally cannot reuse its previous prefix KV. Recasting the same tail into the new user task does not discard a separately reusable old-conversation prefix under ordinary prefix caching. Provider cache lifetime and pricing remain provider-controlled.

## Install

Install directly from this public repository into the `web` profile:

```powershell
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

Or install from a local checkout:

```powershell
git clone https://github.com/whycantiusemyname/dsh-epoch-reanchor.git
cd dsh-epoch-reanchor
npm install
npm run build
dsh plugin --profile web add .
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

Replace `web` with the profile you actually use. The bundle patch is intentionally empty: installation only makes the package resolvable from that profile, while each agent preset mounts its own isolated compaction provider. No process-global AgentLoop or compaction service is replaced.

Restart DSH, create a new blank Session, and choose one A/B preset. Do not switch an existing long-running Session between presets.

Remove the preset directories with:

```text
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web remove dsh-epoch-reanchor
```

## Platform note

POSIX uses the copied official persistent PTY Bash and bare local editor composition. Windows uses a clearly marked process-per-call Git Bash compatibility tool and must not be reported as an exact reproduction of the POSIX RL interface.

## Verification

```text
npm test
npm pack --dry-run
```

Tests cover the official tail cutoff, complete-surface replacement, both reasoning modes, tool-call/result recasting, repeated compaction, default subagent exclusion, summary failure, and single-variable preset parity.

## Evidence and attribution

Official source baseline: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), commit `47f943859bef60e4160492346772ded9b24f765a`, especially the official Minimal preset, `dsh-compaction`, `dsh-compaction-basic`, and Session surface implementation.

The community reference is [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard), including its `anchored-standard`, `zero-anchored-standard`, and `whoami-standard` experimental presets. This project consulted those RL-interface experiments for observations about model-visible system/tool composition, first-request trajectory, and controlled use of the official Minimal interface. It is not a branch of that repository, contains no copied community code, and does not target a PR to it.

The claim that user-role tail recasting reduces trajectory carryover is a local hypothesis to test, not an official DeepSeek statement. See [README.zh-CN.md](./README.zh-CN.md) for the full design, limitations, and A/B procedure, and [NOTICE](./NOTICE) for MIT attribution.
