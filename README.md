**中文** | [English](./README.en.md)

# dsh-epoch-reanchor

`dsh-epoch-reanchor` 是一个 DeepSeek Harness（DSH）实验插件，主要用于测试一个尚未证实的现象：上下文压缩后，摘要和残留轨迹是否会影响模型重新进入以 `We ...`、`Let's ...` 为外显特征的思维链（下文简称“`We/Let's` 特征”）。

插件在压缩边界结束旧的模型可见轨迹，把必要工作状态改写为一条普通用户交接消息，再以官方 Minimal system 和双工具启动新 Epoch。该 Epoch 第一次实际调用工具后，下一步开放完整 Standard 工具集。这个设计尝试尽量消除旧轨迹影响，同时避免整个任务一直受限于双工具。

Session ID、工作目录、原始日志和 UI 历史保持连续；只有模型可见的消息历史被重建。插件不替换官方 AgentLoop。

> [!IMPORTANT]
> `We/Let's` 只是可观察的文本特征，不代表模型的完整内部机制，也不能单独证明推理质量或是否接近某种 RL 后训练分布。本项目用于 A/B 实验，目前没有大规模数据证明某个模式普遍更好。

## 工作方式

```text
Epoch N
  Minimal system + bash/editor
  first tool call → full Standard tools
  append-only trajectory
        │
        │ compaction
        ▼
  older head → handoff summary
  recent tail → numbered records
        │
        ▼
  replace complete model-visible surface
        │
        ▼
Epoch N+1
  Minimal system + bash/editor
  one ordinary user handoff
  first tool call → full Standard tools
```

插件保留官方 compaction 的 pressure threshold、tail 选择、token meter、tool-call/result 安全边界、cache-replay 摘要和失败回滚，只改变最终 replacement：新 Epoch 不再继承旧 assistant/tool role trajectory。

新 Epoch 中模型看到：

```text
System: You are a helpful software engineer assistant.
Tools:  bash + str_replace_editor
User:   earlier task state + recent interaction records
```

首次 durable `tool/call` 后，下一次请求开放官方 Standard preset 的工具集；成功 compaction 后，工具门重新回到双工具状态。首个请求会抑制自动 AGENTS digest 和 skill catalog，开放工具后恢复；`<compacted-summary>`、compaction 内部说明和 runtime snapshot 始终不会注入。

## 两种 A/B 模式

| Preset | Tail reasoning |
|---|---|
| `epoch-reanchor-no-reasoning` | 移除 assistant reasoning block |
| `epoch-reanchor-with-reasoning` | 以 `Reasoning:` 记录保留 reasoning block |

两份 preset 除 `includeTailReasoning` 外完全相同。

recent tail 仍由官方 token budget 算法选择，不做主观 evidence 筛选。用户消息、assistant 可见文本、tool call/result、错误和图片保持原顺序，只被转换成普通编号记录。

## 安装

要求：

- Node.js `^22.19.0` 或 `>=24`；
- DeepSeek Harness `0.1.0-rc.6`。

安装到 `web` profile：

```powershell
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

使用其他 profile 时替换 `web`。package 必须安装到每个需要使用该 preset 的 profile；preset 文件本身安装在全局 `$DSH_HOME/.agent-presets`。

pnpm 可能显示由 DSH installation fallback 提供的官方包 peer dependency warning，这不影响已验证的加载流程。

升级已有安装时，先删除旧 preset 副本，再更新 package 并重新安装：

```powershell
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web add github:whycantiusemyname/dsh-epoch-reanchor
dsh plugin --profile web exec dsh-epoch-reanchor install-presets
```

## 使用

1. 完全重启 DSH；
2. 创建空白 Session；
3. 选择其中一个 Epoch Re-anchor preset；
4. 保持该 Session 使用同一个 preset。

不要在已经产生消息的 Session 中途切换 preset。

查看状态：

```text
dsh plugin --profile web exec dsh-epoch-reanchor status
dsh plugin --profile web exec dsh-epoch-reanchor paths
```

卸载：

```text
dsh plugin --profile web exec dsh-epoch-reanchor remove-presets
dsh plugin --profile web remove dsh-epoch-reanchor
```

仍需 resume 的旧 Session 应保留对应 package 和 preset。

## KV Cache

完成首次工具调用后，Epoch 内仍是 append-only history，完整 Standard 工具 schema 也保持稳定。摘要请求复用旧 system、tools 和 older-head prefix，只追加固定压缩指令。

每个 Epoch 有两次主动前缀变化：边界处从旧历史切到 Minimal 双工具，首次工具调用后再切到完整 Standard 工具集。两次变化都会限制旧 KV 的直接接续；之后直到下一次 compaction 都可继续积累稳定前缀。实际 cache hit、缓存寿命和计价由模型服务提供方决定。

## 平台说明

- **Linux/macOS**：使用从官方 Minimal preset 复制的 persistent PTY Bash 和 bare `fs-local` editor composition。
- **Windows**：使用 process-per-call Git Bash compatibility tool，shell state 不跨调用持久，属于 degraded mode。

Windows 默认 Git Bash 路径：

```text
C:\Program Files\Git\bin\bash.exe
```

安装位置不同时，请修改 preset 中的 `windows-bash.config.bashPath`。

## A/B 建议

为两个模式分别创建新 Session，并固定模型、reasoning effort、任务、仓库状态、权限和 compaction 配置。重点比较压缩后的 `We/Let's` 特征、首次工具调用、完整工具开放后的轨迹、token/cache usage 与最终任务质量。

## 验证

```text
npm test
npm pack --dry-run
```

当前测试覆盖 full-surface replacement、官方 tail boundary、reasoning A/B、tool record 转换、多次 compaction、失败回滚、Epoch 工具门、完整工具开放和 preset 单变量一致性。

## 已知限制

- reasoning-tail 的最佳选择仍需实验；
- 如果模型始终不调用工具，该 Epoch 会继续保持双工具；
- 完整 Standard 工具集开放后是否改变 `We/Let's` 特征，需要通过实验判断；
- role flattening 不会消除 retained text 的语义影响；
- Windows compatibility mode 不等同于 persistent Bash；
- DSH 仍处于 developer preview，升级后需要重新核对官方 API 和 preset composition。

## 来源

官方基线：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，commit `47f943859bef60e4160492346772ded9b24f765a`，主要参考官方 Minimal/Standard preset、`dsh-compaction-basic`、compaction service 和 Session projection。

社区实验参考：[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard) 中针对模型可见 system/tool composition、首轮轨迹和官方 Minimal 接口的 experimental presets。

本项目不是该社区仓库的分支，也没有复制其中代码。官方派生文件归属见 [NOTICE](./NOTICE)。

## License

MIT
