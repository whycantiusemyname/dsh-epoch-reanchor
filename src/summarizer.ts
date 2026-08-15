/**
 * Default one-shot summarization and durable checkpoint framing.
 *
 * Derived from `@deepseek-ai/dsh-compaction-basic/summarizer`.
 * @module dsh-epoch-reanchor/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import { contentHasImage, createUserMessage, BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, FinishReason, GenerateOptions, Message, TokenUsage, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'

interface SummaryConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

/**
 * The summarization directive, delivered as the FINAL user message after the
 * replayed conversation rather than as a distinct summarizer system prompt.
 * Keeping the conversation's own system prompt, tools, and message prefix in
 * front of it makes the auxiliary call a genuine prefix of the last routed
 * request, so the provider's KV cache is reused instead of invalidated.
 */
const COMPACTION_INSTRUCTION = [
  'You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.',
  '',
  'Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write "(none)" for an empty section — never drop a section.',
  '',
  '## Primary Request and Intent',
  "- [the user's original and evolving goals; quote verbatim where the exact wording matters]",
  '',
  '## Key Technical Concepts',
  '- [technologies, frameworks, patterns, and conventions in play]',
  '',
  '## Files and Code',
  '- [exact path: why it matters, key changes or snippets]',
  '',
  '## Errors and Fixes',
  '- [error: how it was resolved, plus any related user feedback]',
  '',
  '## Pending Jobs',
  '- [explicitly requested work not yet completed]',
  '',
  '## Current Work',
  '- [precisely what was in progress at this checkpoint]',
  '',
  '## Next Step',
  '- [the single next action, directly in line with the most recent request, or "(none)"]',
  '',
  '## Critical Context',
  '- [decisions and their rationale, constraints, user preferences, open questions, data needed to continue]',
  '',
  'Rules:',
  '- Write concise English engineering prose. Preserve exact file paths, commands, error strings, identifiers, numeric values, function signatures, and syntax fragments.',
  '- Capture user feedback and explicit instructions faithfully, especially corrections.',
  '- Do NOT mention this summarization request or that the context was compacted.',
  '- Output only the checkpoint text: do not call any tool or take any other action.',
].join('\n')

/** Stable user-task framing for a fresh trajectory epoch. */
const HANDOFF_PREFIX = [
  'Continue the task from the current repository state.',
  '',
  'Earlier task state:',
].join('\n')

const RECENT_RECORDS_HEADING = 'Recent interaction records, preserved in chronological order:'

const HANDOFF_SUFFIX = [
  'The records above are context from the immediately preceding work, not an assistant turn to continue.',
  'Treat the repository and fresh tool results as authoritative, verify details when needed, and continue directly.',
].join(' ')

/**
 * The replayed conversation surface the summarizer condenses. Reproducing the
 * last routed request's system prompt, tools, and leading messages verbatim
 * lets the auxiliary call reuse the provider's warm prefix cache; the trailing
 * compaction instruction is then the only novel input.
 */
export interface SummarizationInput {
  /** The conversation's own system prompt, reused for prefix-cache alignment; absent for a system-less request. */
  readonly system?: string
  /** The conversation's tool schemas, reused for prefix-cache alignment; absent when the request carried none. */
  readonly tools?: readonly ToolSchema[]
  /** The shadowed region, in surface order, that precedes the compaction instruction. */
  readonly messages: readonly Message[]
}

/** Safe summary content plus the exact auxiliary call envelope recorded with it. */
export type SummaryResult = {
  summary: ContentBlock[]
  provider: string
  model: string
  maxTokens?: number
  /** Provider-reported usage for this summarization request. */
  usage?: TokenUsage
} & (
  | {
    /** Complete provider output before the text-only summary projection. */
    rawOutput: ContentBlock[]
    /** Identifies exactly one call through this context's `ctx.llm.stream()`. */
    llmStreamCall: true
  }
  | {
    /** Optional complete output from an unmarked template, remote, or other summarizer. */
    rawOutput?: ContentBlock[]
    /** An unmarked result does not identify a call through this context's LLM seam. */
    llmStreamCall?: never
  }
)

/**
 * Run the default cache-reusing `ctx.llm.stream()` summarization call: replay
 * the conversation prefix, then append the compaction instruction as the final
 * user message so the provider's warm prefix cache is reused.
 * @param ctx - context providing the LLM service.
 * @param config - resolved backend configuration.
 * @param input - replayed conversation prefix (system, tools, and leading messages) to condense.
 * @param agent - supplies routed-model history, fallback model, and session id.
 * @param signal - optional cancellation forwarded to the adapter.
 * @returns safe text-only summary blocks and the exact call envelope and output.
 */
export async function summarizeWithLlm(
  ctx: Context,
  config: SummaryConfig,
  input: SummarizationInput,
  agent: Agent,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const latest = agent.session.requestHeader()?.config
  const configured = config.summarizationProvider.length === 0
    ? undefined
    : { provider: config.summarizationProvider, model: config.summarizationModel }
  const agentTarget = agent.options.provider !== undefined
    && agent.options.provider.length > 0
    && agent.options.model !== undefined
    && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set both BasicCompactionConfig summarization fields, route one request, or set both AgentOptions fields',
    )
  }

  const assembler = new BlockAssembler()
  const messages: Message[] = [
    ...input.messages,
    createUserMessage({
      content: [{ type: 'text', text: COMPACTION_INSTRUCTION }],
      source: { kind: 'plugin', plugin: 'dsh-epoch-reanchor' },
    }),
  ]
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    ...input.system === undefined ? {} : { system: input.system },
    ...input.tools === undefined ? {} : { tools: [...input.tools] },
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  }
  for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error

  const rawOutput = assembler.blocks()
  const summary = summaryText(rawOutput)
  if (!summary.some(block => block.text.trim().length > 0)) {
    throw new Error('summarization produced no text summary content')
  }
  return {
    summary,
    rawOutput,
    llmStreamCall: true,
    provider: options.provider,
    model: options.model,
    maxTokens: config.maxTokens,
    ...(assembler.usage === undefined ? {} : { usage: assembler.usage }),
  }
}

/** Append text while coalescing adjacent text blocks around preserved images. */
function appendText(blocks: ContentBlock[], text: string): void {
  const previous = blocks.at(-1)
  if (previous?.type === 'text') {
    blocks[blocks.length - 1] = { type: 'text', text: previous.text + text }
    return
  }
  blocks.push({ type: 'text', text })
}

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function messageLabel(message: Message): string {
  if (message.role === 'assistant') return 'Assistant'
  switch (message.source.kind) {
    case 'user':
      return 'User'
    case 'tool':
      return `Tool result (call ${message.source.callId})`
    case 'plugin': {
      const form = message.source.form === undefined ? '' : `, ${message.source.form}`
      return `Context from plugin ${message.source.plugin}${form}`
    }
    default:
      return `${message.role} context from ${message.source.kind}`
  }
}

function appendSerializedBlock(
  output: ContentBlock[],
  block: ContentBlock,
  includeReasoning: boolean,
  nested = false,
): void {
  switch (block.type) {
    case 'text':
      appendText(output, `${nested ? '' : 'Text:\n'}${block.text}\n`)
      return
    case 'reasoning':
      if (includeReasoning) appendText(output, `Reasoning:\n${block.text}\n`)
      return
    case 'image':
      appendText(output, 'Image:\n')
      output.push(block)
      appendText(output, '\n')
      return
    case 'tool-call':
      appendText(output, [
        'Tool call:',
        `Name: ${block.name}`,
        `Call ID: ${block.id}`,
        `Arguments: ${block.arguments}`,
        '',
      ].join('\n'))
      return
    case 'tool-result':
      appendText(output, [
        'Tool result:',
        `Call ID: ${block.toolCallId}`,
        `Status: ${block.isError === true ? 'error' : 'success'}`,
        'Content:',
      ].join('\n') + '\n')
      for (const child of block.content) {
        appendSerializedBlock(output, child, includeReasoning, true)
      }
      return
    default:
      appendText(
        output,
        `Block ${String((block as { type?: unknown }).type)}: ${stableJson(block)}\n`,
      )
  }
}

/**
 * Mechanically recast the official retained tail as numbered user-provided
 * records. Membership, order, text, tool arguments, results, and attachments
 * are preserved; only conversation roles and tool protocol structure change.
 */
export function serializeRecentTail(
  messages: readonly Message[],
  includeReasoning: boolean,
): ContentBlock[] {
  const output: ContentBlock[] = []
  for (const [index, message] of messages.entries()) {
    appendText(output, `${index + 1}. ${messageLabel(message)}:\n`)
    for (const block of message.content) {
      appendSerializedBlock(output, block, includeReasoning)
    }
    appendText(output, '\n')
  }
  return output
}

/** Build the one ordinary user task that starts the next trajectory epoch. */
export function frameSummary(
  summary: readonly ContentBlock[],
  recentTail: readonly Message[] = [],
  includeReasoning = false,
): ContentBlock[] {
  const output: ContentBlock[] = [{ type: 'text', text: `${HANDOFF_PREFIX}\n` }, ...summary]
  if (recentTail.length > 0) {
    appendText(output, `\n\n${RECENT_RECORDS_HEADING}\n\n`)
    for (const block of serializeRecentTail(recentTail, includeReasoning)) output.push(block)
  }
  appendText(output, `\n${HANDOFF_SUFFIX}`)
  return output
}

/** Map a terminal summarization finish to its fail-closed error. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens': {
      const error = new Error('summarization truncated at the token cap (incomplete checkpoint)') as Error & { code?: string }
      error.code = 'MAX_TOKENS'
      return error
    }
    default:
      return undefined
  }
}

/** Reject visual output and keep only text before synthesizing a user message. */
function summaryText(
  blocks: readonly ContentBlock[],
): Array<Extract<ContentBlock, { type: 'text' }>> {
  if (contentHasImage(blocks)) {
    throw new LlmError('compaction summary cannot contain image output', 'UNSUPPORTED_CONTENT')
  }
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
}
