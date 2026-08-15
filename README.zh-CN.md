# dsh-epoch-reanchor

`dsh-epoch-reanchor` 是一个面向 DeepSeek Harness（DSH）的实验性 compaction provider。它把一次上下文压缩视为旧模型轨迹的结束，并在同一个 Session 内用一条普通的任务交接消息启动新的轨迹 Epoch。

插件保持 Session ID、工作目录、路由、原始事件日志和 UI 对话记录连续，只重建模型可见的消息历史。它不替换官方 AgentLoop，也不引入 Standard preset 的动态工具状态机。

> [!IMPORTANT]
> 本项目用于验证 trajectory restart 与 tail reasoning 的行为差异。目前没有大规模实验能够证明某个模式普遍更好，也不能把“更接近 RL 后训练分布”当作已证实结论。

## 功能概览

- 基于官方 `dsh-compaction-basic` 源码做最小修改；
- 保留官方 `0.8` pressure threshold、`0.16` retained-tail budget、token meter、overflow retry 和 durable compaction transaction；
- 保留官方 cache-replay 摘要请求；
- compaction 成功后替换整个当前 model-visible surface；
- 将 handoff 作为普通 user-role task 发送给下一 Epoch；
- 将官方 recent tail 机械转换为按时间排序的记录，不进行 evidence 筛选；
- 提供保留或移除 tail reasoning 的两个 A/B preset；
- 默认不对 delegated subagent 自动执行 Epoch compaction；
- Linux/macOS 使用从官方 Minimal preset 复制的双工具 composition；
- Windows 提供明确标记为 degraded 的 Git Bash compatibility mode。

## 工作方式

```text
同一个 DSH Session

Epoch N
  official Minimal system + tools
  append-only messages
  user / assistant / tool trajectory
        │
        │ context pressure 或手动 compact
        ▼
  official head/tail boundary
        ├─ older head → handoff summary
        └─ recent tail → numbered records
        │
        ▼
  full model-visible surface replacement
        │
        ▼
Epoch N+1
  official Minimal system + tools
  one ordinary user handoff
  new append-only trajectory
```

raw session log 中的旧消息不会被删除。DSH 仍可用原有事件记录生成 UI、统计和 telemetry；只有 `session.deriveMessages()` 所代表的当前模型 surface 被 replacement event 重建。

## 模型在新 Epoch 中看到什么

新 Epoch 的起始请求包含：

```text
System: You are a helpful software engineer assistant.
Tools:  bash + str_replace_editor
User:   earlier task state + recent interaction records
```

不会继续发送：

- 旧 Epoch 的原始 assistant/tool role trajectory；
- `<compacted-summary>` 标签；
- compaction id、overflow recovery 等内部说明；
- Standard preset 的额外工具目录；
- runtime context snapshot；
- AGENTS/CLAUDE workspace digest；
- skill catalog 自动注入。

replacement message 在 durable log 内仍使用官方 `compactCheckpointSource(compactionId)` 建立 compaction/UI 关联。该 `source` 元数据不属于发送给模型的消息内容。

## A/B preset

| Preset ID | `includeTailReasoning` | 新 Epoch 中的 tail 内容 |
|---|---:|---|
| `epoch-reanchor-no-reasoning` | `false` | 移除 assistant reasoning block |
| `epoch-reanchor-with-reasoning` | `true` | 以 `Reasoning:` 记录保留 reasoning block |

两份 `agent.cordis.yml` 除这个布尔值外完全一致。测试会持续检查这一条件，避免 A/B 实验混入额外变量。

## Recent tail 的内容

tail 不是固定的“最近 N 条消息”。官方算法从当前 surface 末尾向前累计 token，达到 retention budget 后再调整到安全的 tool-call/result 配对边界。

可能被保留并重新序列化的内容包括：

- 真人输入、follow-up 和 steering message；
- plugin context；
- assistant 可见文本；
- assistant reasoning（仅 with-reasoning 模式）；
- tool name、call id 和 arguments；
- tool result、error 状态和文本内容；
- image attachment；
- 位于 retention range 内的前一次 handoff。

这些内容保持官方选中的成员、顺序和原文，只改变 role 与 tool protocol 结构。例如：

```text
1. User:
Text:
请继续修复测试。

2. Assistant:
Tool call:
Name: bash
Arguments: {"command":"npm test"}

3. Tool result (call ...):
Status: error
Content:
...
```

这种转换会减少旧 assistant/tool 结构的直接延续，但文本本身仍可能影响下一 Epoch 的语义和风格。

## KV Cache 行为

Epoch 内的历史仍然 append-only，可以继续利用不断增长的请求前缀。

摘要请求复用旧请求的 system、tools 和 older-head messages，只在末尾追加固定 compaction instruction。这与官方 `dsh-compaction-basic` 的 cache-replay 设计一致。

Epoch boundary 后，第一条历史消息已被 replacement handoff 改写。普通 prefix-cache 只能复用仍然相同的前缀，因此旧对话 tail 的 KV 无法直接接续；通常仍可能复用固定 system/tools。官方 checkpoint compaction 同样会在历史前部发生 replacement，所以本插件增加的 cache 差异主要集中在 Epoch boundary，而不是每个 step。

实际 cache hit、缓存寿命和计价由模型服务提供方决定，插件不作保证。建议通过 adapter 暴露的 cache usage 做实际 A/B 测量。

## 安装

### 要求

- Node.js `^22.19.0` 或 `>=24`；
- DeepSeek Harness `0.1.0-rc.6` API；
- 目标 DSH profile 已包含官方 base bundle 和 agent preset roster。

### 从 GitHub 安装

以下示例安装到 `web` profile：

```powershell
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

使用其他 profile 时，将 `web` 替换为对应名称。DSH 的 pnpm 安装步骤可能显示官方包的 peer dependency warning；这些包由 DSH installation fallback 提供，公开仓库安装 smoke test 已覆盖这一组合。

bundle patch 有意保持为空。安装 bundle 只让 package 能从该 profile 解析；compaction provider 由 agent preset 在隔离 realm 中挂载，不会成为 process-global provider。

### 从本地源码安装

```powershell
git clone https://github.com/whycantiusemyname/dsh-epoch-reanchor.git
cd dsh-epoch-reanchor
npm install
npm run build
dsh plugin --profile web add .
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

### 启用 preset

1. 完全重启 DSH；
2. 创建一个空白 Session；
3. 选择 `Epoch Re-anchor — No Reasoning Tail` 或 `Epoch Re-anchor — With Reasoning Tail`；
4. 发送任务并保持该 Session 使用同一个 preset。

不要在已经产生消息的长 Session 中途切换 preset。

## 管理命令

查看安装状态：

```text
dsh plugin --profile web exec dsh-epoch-reanchor status
dsh plugin --profile web exec dsh-epoch-reanchor paths
```

卸载：

```text
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web remove dsh-epoch-reanchor
```

删除 preset 或 package 后，依赖这些 preset 的旧 Session 可能无法重新 composition。需要继续 resume 的 Session 应保留对应 preset 和 package。

## Preset 配置

默认 preset 中的 compaction 配置如下：

```yaml
- id: epoch-compaction
  name: dsh-epoch-reanchor
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    includeTailReasoning: false # 或 true
    includeSubagents: false
    auto: true
```

provider 还保留官方以下配置项：

- `retainTokens`；
- `summarizationProvider` / `summarizationModel`；
- `maxTokens`；
- `compactionRetries`；
- `maxOverflowRetries`；
- `modelPolicies`。

为保持实验变量清晰，建议先使用 packaged preset 的默认 threshold、retention 和 summary route，只切换 `includeTailReasoning`。

## A/B 测试建议

为两种模式分别创建全新 Session，并固定：

- 模型与 provider；
- reasoning effort；
- 初始任务与仓库状态；
- compaction threshold 与 retention budget；
- summary route；
- permission mode。

建议记录 compaction 后第 1、5、10、20 个 step 的：

- 首次工具调用延迟；
- 工具调用密度；
- 对最近错误与修正的恢复情况；
- 重复探索和重复修改；
- reasoning 与 visible response 的稳定性；
- token、延迟、cache usage 和最终任务质量。

表面词频可以作为辅助信号，不应作为唯一判断依据。

## 平台说明

### Linux / macOS

使用从官方 Minimal preset 复制的 persistent PTY Bash、`str_replace_editor` 和 bare `fs-local` composition，可描述为与该官方 Minimal composition 对齐。

### Windows

使用 Git Bash process-per-call compatibility tool。模型可见工具名仍为 `bash`，但 shell state 不跨调用持久，因此属于 degraded mode。Windows 数据不应与 POSIX exact-composition 数据混合统计。

默认路径为：

```text
C:\Program Files\Git\bin\bash.exe
```

如安装位置不同，请修改 preset 中 `windows-bash.config.bashPath`。

## 失败语义

- summary 生成失败时不替换当前 surface；
- compaction transaction 会记录失败的 `compaction/end`；
- pressure compaction 失败时当前 turn 继续；
- provider-confirmed context overflow 只在出现 durable surface progress 后重试；
- replacement 必须小于被 shadow 的完整内容，否则 compaction 失败；
- delegated subagent 默认跳过自动 Epoch compaction。

## 验证

```text
npm test
npm pack --dry-run
```

当前测试覆盖：

- 官方 retained-tail boundary；
- full-surface replacement；
- reasoning A/B；
- tool-call/result 普通记录化；
- 多次 compaction；
- Session 连续性；
- subagent 默认排除；
- summary failure；
- 两份 preset 单变量一致性；
- bundle 不安装全局 AgentLoop 或 compaction provider。

发布仓库还经过以下真实 smoke test：

- `dsh plugin --profile ... add github:whycantiusemyname/dsh-epoch-reanchor`；
- CLI preset install/status/remove；
- 两种 preset 的真实 DSH Loader composition；
- packed package 与公开 GitHub dependency 安装；
- 无凭据情况下运行到预期的 `MISSING_CREDENTIAL`，证明 preset 已完成加载。

## 已知限制

- 没有大规模 benchmark 能证明 reasoning-tail 的最佳选择；
- role flattening 不会消除 tail 文本的语义或风格影响；
- 单个不可分 surface node、system prompt 或 tool schema 本身过大时，history compaction 无法解决容量问题；
- overflow recovery 仍要求摘要请求能够被 provider 接受；
- Windows compatibility mode 不具备 persistent Bash 语义；
- DSH 仍处于 developer preview，升级后应重新核对官方 compaction diff 和 preset composition。

## 来源与归属

官方实现基线：

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，commit `47f943859bef60e4160492346772ded9b24f765a`；
- `packages/compaction/compaction-basic`；
- `packages/compaction/compaction`；
- `packages/core/session`；
- `apps/cli/config/agent-presets/minimal/agent.cordis.yml`；
- [DSH 开发文档](https://deepseek-harness.github.io/deepseek-harness/develop/basic/)；
- [Cordis 教程](https://deepseek-harness.github.io/deepseek-harness/develop/cordis-tutorial/)。

社区实验参考：

- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)，包括其中针对模型可见 system/tool composition、首轮轨迹和官方 Minimal 接口的 experimental presets。

本项目不是该社区仓库的分支，没有复制其中代码，也不以向其提交 PR 为目标。官方派生文件和 MIT attribution 见 [NOTICE](./NOTICE)。

## License

MIT
