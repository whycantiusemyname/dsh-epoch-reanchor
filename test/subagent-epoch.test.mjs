import assert from 'node:assert/strict'
import test from 'node:test'

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'

import {
  apply,
  deferredPersonaOf,
  MINIMAL_PERSONA,
  ROLE_GUIDANCE_HEADING,
} from '../lib/subagent-epoch.js'

function register(config = {}) {
  const listeners = {}
  apply({
    on(event, listener) {
      listeners[event] = listener
    },
  }, config)
  return listeners
}

function freshChild() {
  const id = SessionId(`fresh-child-${crypto.randomUUID()}`)
  const session = Session.create(id, undefined, {
    version: 0,
    id,
    createdAt: Date.now(),
    origin: 'subagent',
    delegationDepth: 1,
  })
  return { session, options: {} }
}

function assembly(persona, variables = {}) {
  return {
    sections: [
      { name: 'deployment:persona', text: persona },
      { name: 'tool:extra-guidance', text: 'Extra system guidance.' },
    ],
    contexts: [{ name: 'subagent:delegation', text: 'delegated runtime context' }],
    tools: [{ name: 'bash' }, { name: 'str_replace_editor' }],
    variables,
  }
}

function task(text = 'Review the implementation.') {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

test('fresh child system stays exact Minimal while its persona moves to the durable user task', async () => {
  const listeners = register({ mode: 'fresh' })
  const agent = freshChild()
  const customPersona = 'You are a meticulous reviewer.'
  const assembled = await listeners['system-prompt/assemble'](
    undefined,
    { agent },
    async () => assembly(customPersona),
  )
  assert.deepEqual(assembled.sections, [
    { name: 'deployment:persona', text: MINIMAL_PERSONA },
  ])
  assert.deepEqual(assembled.contexts, [])

  const original = task()
  const decision = await listeners['agent/pre-step'](
    { agent },
    async () => ({ kind: 'enter', messages: [original] }),
  )
  assert.equal(decision.kind, 'enter')
  const text = decision.messages[0].content.map(block => block.text ?? '').join('')
  assert.match(text, /Review the implementation\./u)
  assert.match(text, new RegExp(`${ROLE_GUIDANCE_HEADING}\\n${customPersona}`, 'u'))
  assert.equal(original.content[0].text, 'Review the implementation.')
  assert.equal(deferredPersonaOf(agent.session), customPersona)
  assert.equal(
    agent.session.events.filter(event => event.type === 'epoch-reanchor/agent-context').length,
    1,
  )
})

test('persona templates are resolved before becoming external agent context', async () => {
  const listeners = register({ mode: 'fresh' })
  const agent = freshChild()
  await listeners['system-prompt/assemble'](
    undefined,
    { agent },
    async () => assembly('Review the repository at {{cwd}}.', { cwd: 'C:/workspace' }),
  )
  const decision = await listeners['agent/pre-step'](
    { agent },
    async () => ({ kind: 'enter', messages: [task()] }),
  )
  assert.equal(decision.kind, 'enter')
  assert.match(
    decision.messages[0].content.map(block => block.text ?? '').join(''),
    /Review the repository at C:\/workspace\./u,
  )
  assert.equal(deferredPersonaOf(agent.session), 'Review the repository at C:/workspace.')
})

test('a child without a custom persona gets no duplicate Minimal role footer', async () => {
  const listeners = register({ mode: 'fresh' })
  const agent = freshChild()
  await listeners['system-prompt/assemble'](
    undefined,
    { agent },
    async () => assembly(MINIMAL_PERSONA),
  )
  const original = task()
  const decision = await listeners['agent/pre-step'](
    { agent },
    async () => ({ kind: 'enter', messages: [original] }),
  )
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages[0], original)
  assert.equal(deferredPersonaOf(agent.session), undefined)
})

test('the initial persona is projected once and ordinary later user turns are untouched', async () => {
  const listeners = register({ mode: 'fresh' })
  const agent = freshChild()
  await listeners['system-prompt/assemble'](
    undefined,
    { agent },
    async () => assembly('You are a reviewer.'),
  )
  const first = await listeners['agent/pre-step'](
    { agent },
    async () => ({ kind: 'enter', messages: [task('Initial task')] }),
  )
  assert.equal(first.kind, 'enter')
  agent.session.append('user/message', first.messages[0], { surfaceOp: 'append' })

  const later = task('Later correction')
  const second = await listeners['agent/pre-step'](
    { agent },
    async () => ({ kind: 'enter', messages: [later] }),
  )
  assert.equal(second.kind, 'enter')
  assert.equal(second.messages[0], later)
})

test('fork-seeded and top-level sessions retain their official prompt behavior', async () => {
  const listeners = register({ mode: 'fresh' })
  for (const header of [
    { origin: 'subagent', delegationDepth: 1, seedLength: 8 },
    {},
  ]) {
    const agent = {
      session: { header, events: [], surface: { nodes: [] } },
      options: {},
    }
    const original = assembly('You are a reviewer.')
    const assembled = await listeners['system-prompt/assemble'](
      undefined,
      { agent },
      async () => original,
    )
    assert.equal(assembled, original)
  }
})

test('invalid projection modes fail at mount time', () => {
  assert.throws(() => register({ mode: 'spawn-only' }), /mode/u)
})
