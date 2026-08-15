# dsh-epoch-reanchor

`dsh-epoch-reanchor` 是一个独立的 DeepSeek Harness（DSH）实验插件：保留同一个 Session、完整事件日志和 UI 历史，但把每次自动压缩变成一次新的模型对话。

它不替换官方 AgentLoop。实现以官方 `dsh-compaction-basic` 为基线，只修改压缩范围的落地方式和 replacement user message 的内容。

## 核心行为

```text
官方 Minimal system + tools
        │
        ├─ Epoch N：正常 append-only trajectory
        │
        ├─ 达到官方 pressure threshold
        │
        ├─ 按官方算法划分 older head / recent tail
        │      ├─ head：使用原前缀生成 handoff summary
        │      └─ tail：保持官方成员与顺序，机械改写为编号记录
        │
        └─ 整个 surface → 一条普通 user handoff
                         ↓
                    Epoch N+1
```

模型在新 Epoch 中看到：

```text
System: You are a helpful software engineer assistant.
Tools:  bash + str_replace_editor
User:   earlier task state + recent interaction records
```

不会看到：

- `<compacted-summary>`；
- compaction id 或内部恢复说明；
- 原始 assistant/tool 角色 tail；
- Standard preset 的额外工具、runtime context、AGENTS/skill catalog 注入。

## 两个 A/B preset

两个 preset 从同一份官方 Minimal composition 复制，仅有一个配置值不同：

| Preset ID | `includeTailReasoning` | 行为 |
|---|---:|---|
| `epoch-reanchor-no-reasoning` | `false` | recent tail 中的 reasoning block 不进入新 user context |
| `epoch-reanchor-with-reasoning` | `true` | reasoning 以 `Reasoning:` 编号记录进入新 user context |

测试会比较两份 `agent.cordis.yml`，确保除这个布尔值外完全相同。

这两个模式都保留 tail 中其他内容的成员、顺序和原文：用户消息、插件上下文、assistant 可见文本、工具名称、参数、结果、错误状态和图像 attachment。它们不对“什么信息重要”作主观筛选。

## 与官方 Compaction 的关系

保留的官方机制：

- `ctx.compaction` / `CompactionEngine` service seam；
- `agent/pre-step` 压力检查；
- `agent/request-error` 的 canonical context-overflow retry；
- `ctx.tokenMeter` 测量；
- 默认 `thresholdRatio = 0.8`；
- 默认 `retainRatio = 0.16`；
- tool-call/result balanced boundary；
- 可选 tool-result pruning；
- cache-friendly summary request；
- `compaction/start → summary → replacement → end` durable transaction；
- summary 失败时保持原 surface；
- raw log 保留被 shadow 的原始事件；
- 官方 UI 对 compaction checkpoint 的关联与展示。

修改的部分：

1. 官方只替换 older head，并让 recent tail 继续保持原角色；本插件替换整个当前 surface。
2. 官方使用 `<compacted-summary>` checkpoint framing；本插件生成普通 continuation user task。
3. 官方 tail 保持 assistant/tool 协议结构；本插件将同一批 tail 节点按顺序序列化为 user-provided records。

replacement 仍使用官方 `compactCheckpointSource(compactionId)` 作为内部来源。这只用于 durable 关联和 UI；模型看不到 `source` 元数据。

## 官方 tail 具体包含什么

官方不是按“最近 N 条消息”选择 tail，而是从 surface 末尾向前累计 token，直到达到保留预算，再向前移动到安全的工具配对边界。

可能进入 tail 的 surface 节点包括：

- `user/message`：真人用户消息、steering/followup、插件 context；
- `assistant/message`：text、reasoning、tool-call block；
- `tool/result`：调用关联、文本/图像结果和错误状态；
- 之前落地的 handoff checkpoint（如果它恰好位于保留预算内）。

不会进入 tail 的日志事件包括 turn/step boundary、assistant chunk、request header、`compaction/*` 和 telemetry。

序列化是确定性的：按 surface 顺序编号，根据 `message.source` 标注 `User`、`Assistant`、`Tool result` 或插件 context；tool-call 和 tool-result 不再作为 provider tool protocol，而是普通文本记录。已知图像 block 保留为图像 block。

## KV Cache 语义

Epoch 内仍然是 append-only history，正常利用不断增长的前缀缓存。

handoff summary 请求复用旧请求的 system、tools 和 older-head messages，然后只追加固定 compaction instruction。它与官方 `compaction-basic` 使用相同的 cache-replay 思路。

压缩后，官方 checkpoint 在第一条历史消息处替换旧内容，因此在普通 prefix-cache 模型下，原 recent tail 的旧 KV 本来也无法直接接续；可复用部分通常只剩固定 system/tools。将 tail 改写进一条新 user message 不会额外丢失一段本来可连续使用的旧对话 KV。

服务端是否跨请求缓存固定 system/tools、缓存存活时间和 cache-hit 计价均由提供方决定，本插件不作保证。

## 安装

要求：

- Node.js `^22.19.0` 或 `>=24`；
- DeepSeek Harness `0.1.0-rc.6` API；
- DSH profile 已包含官方 base bundle 和 agent preset roster。

直接从本公开仓库安装到 `web` profile：

```powershell
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

从本地 checkout 安装：

```powershell
git clone https://github.com/whycantiusemyname/dsh-epoch-reanchor.git
cd dsh-epoch-reanchor
npm install
npm run build
dsh plugin --profile web add .
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

如果实际使用其他 profile，把以上命令中的 `web` 换成对应名称。bundle patch 有意保持为空：安装步骤只让包进入该 profile 的模块解析路径，compaction provider 仅由每个 agent preset 在隔离 realm 中挂载，不会全局替换 AgentLoop 或 compaction service。

完全重启 DSH，新建空白 Session，并选择其中一个 A/B preset。不要在已有长 Session 中途切换 preset。

查看安装状态：

```text
dsh plugin --profile web exec dsh-epoch-reanchor status
dsh plugin --profile web exec dsh-epoch-reanchor paths
```

卸载 preset：

```text
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web remove dsh-epoch-reanchor
```

## A/B 方法

建议固定：

- 相同模型、provider、reasoning effort；
- 相同任务与初始仓库；
- 相同 threshold、retain budget、summary route；
- 两个全新 Session；
- 唯一变量为 `includeTailReasoning`。

重点观察压缩后 1、5、10、20 step：

- 是否重复已完成工作；
- 首次工具调用延迟；
- 工具调用密度；
- 对最近错误与用户修正的恢复率；
- reasoning/visible response 的轨迹稳定性；
- 最终任务质量、token、延迟和 cache usage（若 adapter 暴露）。

不要把 `we`、`let me` 等表面词频当作唯一结论。

## POSIX 与 Windows

Linux/macOS 使用从官方 Minimal 复制的 persistent PTY Bash 和 bare `fs-local` editor，可称为官方 Minimal composition 对齐。

Windows preset 使用 Git Bash process-per-call compatibility tool：模型可见名称仍为 `bash`，但进程状态不跨调用持久，因此明确属于 degraded compatibility mode，不应与 POSIX exact 结果混合统计。

## 已知限制

- 当前没有大规模实验能证明 reasoning-tail 哪一种普遍更好；两个 preset 正是为此保留。
- 将 assistant 内容改成 user records 会移除角色/工具协议轨迹，但原文仍可能产生语义和风格影响，不能声称完全消除轨迹影响。
- 单个不可分节点过大、system/tools envelope 本身过大等问题无法通过 surface compaction 修复。
- provider-confirmed overflow 仍受摘要请求可容纳性的限制；正常路径应在 0.8 pressure threshold 主动触发。
- reasoning 模式会把旧 tail 的 reasoning 文本送入下一 Epoch，请仅用于明确的 A/B 实验并按数据治理要求处理日志。
- DSH 仍处于 developer preview；升级时应重新核对官方 compaction provider diff。

## 验证

```text
npm test
npm pack --dry-run
```

测试覆盖：官方 tail cutoff、完整 surface hard replacement、两种 reasoning 模式、工具调用/结果序列化、多次 compaction、subagent 默认排除、summary failure 和 A/B preset 单变量一致性。

## 证据与参考分层

### 官方证据

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，固定参考 commit `47f943859bef60e4160492346772ded9b24f765a`；
- `apps/cli/config/agent-presets/minimal/agent.cordis.yml`：Minimal system、complete prompt、runtime suppression、persistent bash、bare editor；
- `packages/compaction/compaction`：`CompactionEngine` 和 durable surface-replacement contract；
- `packages/compaction/compaction-basic`：pressure、retention、cache replay、summary transaction、overflow retry；
- `packages/core/session`：raw log 与 model-visible surface 分离；
- [官方开发文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) 与 [Cordis 教程](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/)。

### 本地假设

- 将 recent tail 从 assistant/tool roles 改成单个 user-provided record，可能减少压缩后旧轨迹结构的延续；
- reasoning 是否应保留没有官方结论，因此作为唯一 A/B 变量；
- “更接近 RL 分布”只作为待验证假设，不作为 DeepSeek 官方事实。

### 社区思路参考

- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)：其中 `anchored-standard`、`zero-anchored-standard` 和 `whoami-standard` 等实验 preset 对 V4 Pro 的模型可见 system/tool composition、首轮轨迹和官方 Minimal 接口进行了对照研究。本插件只参考了这类 RL 接口实验的观察与隔离变量思路。

本项目不是该 preset 仓库的分支，不向其提交 PR，也没有复制其中代码。具体来源和官方 MIT attribution 见 [NOTICE](./NOTICE)。

## License

MIT。官方派生部分和固定 commit 见 `NOTICE`。
