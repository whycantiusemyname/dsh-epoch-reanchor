import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  createMessage,
  createToolResultMessage,
  createUserMessage,
  LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import TokenMeter from '@deepseek-ai/dsh-token-meter'

import EpochCompactionEngine, {
  selectCompactableEpoch,
  selectCompactableRange,
  serializeRecentTail,
} from '../lib/index.js'

const MODEL = 'epoch-test-model'
const SIGNAL = new AbortController().signal

class ContextAdapter extends LlmAdapter {
  constructor(contextWindow) {
    super()
    this.contextWindow = contextWindow
  }

  resolveModel(provider, model) {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: this.contextWindow },
    })
  }

  async * stream() {
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

class TestEpochCompactionEngine extends EpochCompactionEngine {
  calls = []
  failure

  async summarize(input, _agent, signal) {
    this.calls.push({ input, signal })
    if (this.failure !== undefined) throw this.failure
    return {
      summary: [{ type: 'text', text: 'Small durable handoff.' }],
      provider: MODEL,
      model: MODEL,
    }
  }
}

function appendAssistant(session, turn, step, content) {
  session.append('assistant/message', {
    turn,
    step,
    message: createMessage({
      role: 'assistant',
      content,
      source: { kind: 'model', provider: MODEL, model: MODEL },
    }),
  }, { surfaceOp: 'append' })
}

function conversation(delegationDepth = 0) {
  const id = SessionId(`epoch-${crypto.randomUUID()}`)
  const session = Session.create(
    id,
    undefined,
    {
      version: 0,
      id,
      createdAt: Date.now(),
      ...delegationDepth === 0 ? {} : { delegationDepth },
    },
  )
  const large = 'older repository work '.repeat(350)

  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `${large}user request` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('request/header', {
    header: {
      config: { provider: MODEL, model: MODEL },
      system: 'You are a helpful software engineer assistant.',
    },
    reason: 'initial',
  })
  appendAssistant(session, 1, 1, [{ type: 'text', text: `${large}assistant work` }])
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  session.append('turn/start', { turn: 2 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `${large}latest user correction` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 2, step: 1 })
  appendAssistant(session, 2, 1, [
    { type: 'reasoning', text: 'PRIVATE-TAIL-REASONING' },
    { type: 'text', text: 'Latest visible assistant response.' },
  ])
  session.append('step/end', { turn: 2, step: 1 })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 3 })
  return session
}

function harness(includeTailReasoning) {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  void new TokenMeter(ctx)
  ctx.llm.registerAdapter([MODEL], new ContextAdapter(4_000))
  const engine = new TestEpochCompactionEngine(ctx, {
    auto: false,
    thresholdRatio: 0.8,
    retainTokens: 1,
    includeTailReasoning,
  })
  return { ctx, engine }
}

async function compactMode(includeTailReasoning) {
  const { ctx, engine } = harness(includeTailReasoning)
  const session = conversation()
  const beforeNodes = [...session.surface.nodes]
  const beforeMessages = session.deriveMessages()
  const result = await engine.compactIfNeeded(
    { session, options: { provider: MODEL, model: MODEL } },
    'pressure',
    SIGNAL,
  )
  assert.ok(result)
  return { ctx, engine, session, result, beforeNodes, beforeMessages }
}

test('uses the official tail boundary but replaces the complete surface', async () => {
  const { engine, session, result, beforeNodes, beforeMessages } = await compactMode(false)
  const call = engine.calls[0]
  assert.ok(call)

  assert.deepEqual(result.shadowedSeqs, beforeNodes)
  assert.deepEqual(
    call.input.messages.map(message => message.id),
    beforeMessages.slice(0, -1).map(message => message.id),
  )
  assert.equal(call.input.system, 'You are a helpful software engineer assistant.')

  const visible = session.deriveMessages()
  assert.equal(visible.length, 1)
  assert.equal(visible[0].role, 'user')
  const text = visible[0].content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  assert.match(text, /Earlier task state:/)
  assert.match(text, /Recent interaction records/)
  assert.match(text, /Latest visible assistant response\./)
  assert.doesNotMatch(text, /<compacted-summary>/)
  assert.doesNotMatch(text, /PRIVATE-TAIL-REASONING/)

  assert.equal(
    session.events.some(event => event.type === 'assistant/message'
      && event.data.message.content.some(block => block.type === 'reasoning')),
    true,
  )
})

test('the A/B modes differ by retained-tail reasoning content', async () => {
  const without = await compactMode(false)
  const withReasoning = await compactMode(true)
  const textOf = session => session.deriveMessages()[0].content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')

  assert.doesNotMatch(textOf(without.session), /PRIVATE-TAIL-REASONING/)
  assert.match(textOf(withReasoning.session), /Reasoning:\nPRIVATE-TAIL-REASONING/)
})

test('selectCompactableEpoch keeps the official head cutoff', () => {
  const { ctx } = harness(false)
  const session = conversation()
  const measurement = ctx.tokenMeter.measure(session)
  const official = selectCompactableRange(session, measurement, 1)
  const epoch = selectCompactableEpoch(session, measurement, 1)
  assert.ok(official)
  assert.ok(epoch)
  assert.equal(epoch.start, session.surface.nodes[0])
  assert.equal(epoch.end, session.surface.nodes.at(-1))
  assert.equal(epoch.summaryEnd, official.end)
})

test('serializeRecentTail preserves order and changes only reasoning policy', () => {
  const messages = conversation().deriveMessages().slice(-2)
  const without = serializeRecentTail(messages, false)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  const withReasoning = serializeRecentTail(messages, true)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  assert.match(without, /^1\. User:/)
  assert.match(without, /2\. Assistant:/)
  assert.doesNotMatch(without, /PRIVATE-TAIL-REASONING/)
  assert.match(withReasoning, /PRIVATE-TAIL-REASONING/)
})

test('tool calls and results become plain chronological records', () => {
  const callId = CallId('tail-call')
  const assistant = createMessage({
    role: 'assistant',
    source: { kind: 'model', provider: MODEL, model: MODEL },
    content: [
      { type: 'reasoning', text: 'tool reasoning' },
      { type: 'tool-call', id: callId, name: 'bash', arguments: '{"command":"npm test"}' },
    ],
  })
  const result = createToolResultMessage({
    callId,
    content: [{ type: 'text', text: 'all tests passed' }],
    isError: false,
  })
  const serialized = serializeRecentTail([assistant, result], true)
  assert.equal(serialized.every(block => block.type === 'text'), true)
  const text = serialized.map(block => block.text).join('')
  assert.match(text, /1\. Assistant:/)
  assert.match(text, /Name: bash/)
  assert.match(text, /Arguments: \{"command":"npm test"\}/)
  assert.match(text, /2\. Tool result \(call tail-call\):/)
  assert.match(text, /all tests passed/)
})

test('multiple compactions keep one session and advance through full-surface replacements', async () => {
  const { engine } = harness(false)
  const session = conversation()
  const sessionId = session.id
  const first = await engine.compactIfNeeded(
    { session, options: { provider: MODEL, model: MODEL } },
    'pressure',
    SIGNAL,
  )
  assert.ok(first)

  const large = 'new epoch work '.repeat(900)
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: `${large}follow-up` }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('step/start', { turn: 3, step: 1 })
  appendAssistant(session, 3, 1, [{ type: 'text', text: 'Second epoch assistant completion.' }])
  session.append('step/end', { turn: 3, step: 1 })

  const beforeSecond = [...session.surface.nodes]
  const second = await engine.compactIfNeeded(
    { session, options: { provider: MODEL, model: MODEL } },
    'pressure',
    SIGNAL,
  )
  assert.ok(second)
  assert.equal(session.id, sessionId)
  assert.deepEqual(second.shadowedSeqs, beforeSecond)
  assert.equal(session.deriveMessages().length, 1)
  assert.equal(
    session.events.filter(event => event.type === 'compaction/summary').length,
    2,
  )
})

test('automatic compaction skips delegated sessions by default', async () => {
  const { engine } = harness(false)
  const delegated = conversation(1)
  const before = [...delegated.surface.nodes]
  const result = await engine.compactIfNeeded(
    { session: delegated, options: { provider: MODEL, model: MODEL } },
    'pressure',
    SIGNAL,
  )
  assert.equal(result, null)
  assert.deepEqual(delegated.surface.nodes, before)
})

test('summary failure closes the transaction without changing the surface', async () => {
  const { engine } = harness(false)
  const session = conversation()
  const before = [...session.surface.nodes]
  engine.failure = new Error('summary unavailable')
  await assert.rejects(
    engine.compactIfNeeded(
      { session, options: { provider: MODEL, model: MODEL } },
      'pressure',
      SIGNAL,
    ),
    /summary unavailable/,
  )
  assert.deepEqual(session.surface.nodes, before)
  assert.equal(session.events.some(event => event.type === 'compaction/summary'), false)
  assert.equal(
    session.events.some(event => event.type === 'compaction/end'
      && event.data.error?.includes('summary unavailable')),
    true,
  )
})

test('the packaged A/B presets are identical except for reasoning mode metadata', async () => {
  const base = new URL('../preset/', import.meta.url)
  const without = await readFile(new URL('epoch-reanchor-no-reasoning/agent.cordis.yml', base), 'utf8')
  const withReasoning = await readFile(new URL('epoch-reanchor-with-reasoning/agent.cordis.yml', base), 'utf8')
  assert.equal(
    without.replace('includeTailReasoning: false', 'includeTailReasoning: MODE'),
    withReasoning.replace('includeTailReasoning: true', 'includeTailReasoning: MODE'),
  )
})

test('the packaged presets gate a complete Standard catalog behind the first tool call', async () => {
  const preset = await readFile(
    new URL('../preset/epoch-reanchor-no-reasoning/agent.cordis.yml', import.meta.url),
    'utf8',
  )
  const requiredRows = [
    'dsh-epoch-reanchor/tool-bootstrap',
    'dsh-epoch-reanchor/windows-bash',
    '@deepseek-ai/dsh-agent-instructions',
    '@deepseek-ai/dsh-tool-pwsh',
    '@deepseek-ai/dsh-tool-fs',
    '@deepseek-ai/dsh-tool-fs-search',
    '@deepseek-ai/dsh-tool-jobs',
    '@deepseek-ai/dsh-tool-skill',
    '@deepseek-ai/dsh-tool-goal',
    '@deepseek-ai/dsh-plan-mode',
    '@deepseek-ai/dsh-tool-subagent-control',
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-workflow',
    '@deepseek-ai/dsh-tool-ralph',
    '@deepseek-ai/dsh-tool-ask-user',
    '@deepseek-ai/dsh-tool-todo',
    '@deepseek-ai/dsh-tool-web',
  ]
  for (const row of requiredRows) assert.match(preset, new RegExp(row.replaceAll('/', '\\/'), 'u'))
  assert.match(preset, /epochReanchorSettings\.windowsShell === 'pwsh'.*'pwsh'.*'bash'/u)
  assert.match(preset, /ctx\.get\('epochReanchorSettings'\)\?\.windowsShell !== 'git-bash'/u)
  assert.match(preset, /bashPath: !!js ctx\.epochReanchorSettings\.gitBashPath/u)
  assert.ok(preset.indexOf('dsh-epoch-reanchor/tool-bootstrap') < preset.indexOf('@deepseek-ai/dsh-agent-instructions'))
  assert.ok(preset.indexOf('dsh-epoch-reanchor/tool-bootstrap') < preset.indexOf('@deepseek-ai/dsh-tool-skill'))
})

test('the bundle installs only the process-global restart-scoped settings service', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const effective = patch
    .split(/\r?\n/u)
    .filter(line => !line.trimStart().startsWith('#'))
    .join('\n')
  assert.match(effective, /id: epoch-reanchor-settings/u)
  assert.match(effective, /name: dsh-epoch-reanchor\/settings/u)
  assert.doesNotMatch(effective, /agent-loop|compaction/u)
})
