import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, name } from '../preset/tool-bootstrap.mjs'

function register(config = {}) {
  const listeners = {}
  const hookOptions = {}
  const warnings = []
  apply({
    on(event, listener, options) {
      listeners[event] = listener
      hookOptions[event] = options
    },
    logger: { warn: warning => warnings.push(warning) },
  }, config)
  return { listeners, hookOptions, warnings }
}

function makeAgent(events = [], header = {}) {
  return { session: { id: 'session', events, header } }
}

function assemble(listener, agent, tools) {
  return listener(undefined, { agent }, async () => ({ system: 'minimal', tools }))
}

const catalog = [
  { name: 'bash' },
  { name: 'pwsh' },
  { name: 'str_replace_editor' },
  { name: 'read' },
  { name: 'web_search' },
  { name: 'subagent' },
]

test('exports a diagnostic plugin name', () => {
  assert.equal(name, 'epoch-tool-bootstrap')
})

test('the default epoch starts with the POSIX Minimal tool pair', async () => {
  const { listeners } = register()
  const result = await assemble(listeners['system-prompt/assemble'], makeAgent(), catalog)
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])
})

test('a native Windows epoch can use the official pwsh/editor pair', async () => {
  const { listeners } = register({ bootstrapTools: ['pwsh', 'str_replace_editor'] })
  const result = await assemble(listeners['system-prompt/assemble'], makeAgent(), catalog)
  assert.deepEqual(result.tools.map(tool => tool.name), ['pwsh', 'str_replace_editor'])
})

test('an assistant reply without tool use does not open the catalog', async () => {
  const { listeners } = register()
  const agent = makeAgent([{ type: 'assistant/message', seq: 1, data: {} }])
  const result = await assemble(listeners['system-prompt/assemble'], agent, catalog)
  assert.deepEqual(result.tools.map(tool => tool.name), ['bash', 'str_replace_editor'])
})

test('the first durable tool call opens the complete assembled catalog', async () => {
  const { listeners } = register()
  const agent = makeAgent([{ type: 'tool/call', seq: 1, data: { name: 'bash' } }])
  const result = await assemble(listeners['system-prompt/assemble'], agent, catalog)
  assert.equal(result.tools, catalog)
})

test('a successful compaction closes the catalog until the new epoch uses a tool', async () => {
  const { listeners } = register()
  const agent = makeAgent([{ type: 'tool/call', seq: 1, data: { name: 'bash' } }])
  assert.equal((await assemble(listeners['system-prompt/assemble'], agent, catalog)).tools, catalog)

  listeners['session/event'](agent.session, { type: 'compaction/end', seq: 2, data: {} })
  assert.deepEqual(
    (await assemble(listeners['system-prompt/assemble'], agent, catalog)).tools.map(tool => tool.name),
    ['bash', 'str_replace_editor'],
  )

  listeners['session/event'](agent.session, { type: 'tool/call', seq: 3, data: { name: 'str_replace_editor' } })
  assert.equal((await assemble(listeners['system-prompt/assemble'], agent, catalog)).tools, catalog)
})

test('a failed compaction does not close an already open catalog', async () => {
  const { listeners } = register()
  const agent = makeAgent([{ type: 'tool/call', seq: 1, data: { name: 'bash' } }])
  await assemble(listeners['system-prompt/assemble'], agent, catalog)
  listeners['session/event'](agent.session, {
    type: 'compaction/end',
    seq: 2,
    data: { error: 'summary unavailable' },
  })
  assert.equal((await assemble(listeners['system-prompt/assemble'], agent, catalog)).tools, catalog)
})

test('subagents receive the full catalog immediately by default', async () => {
  const { listeners } = register()
  const result = await assemble(
    listeners['system-prompt/assemble'],
    makeAgent([], { delegationDepth: 1 }),
    catalog,
  )
  assert.equal(result.tools, catalog)
})

test('fresh local subagents use the Minimal pair and promote independently', async () => {
  const { listeners } = register({ subagentMode: 'fresh' })
  const agent = makeAgent([], { origin: 'subagent', delegationDepth: 1 })
  assert.deepEqual(
    (await assemble(listeners['system-prompt/assemble'], agent, catalog)).tools.map(tool => tool.name),
    ['bash', 'str_replace_editor'],
  )
  listeners['session/event'](agent.session, {
    type: 'tool/call',
    seq: 1,
    data: { name: 'bash' },
  })
  assert.equal((await assemble(listeners['system-prompt/assemble'], agent, catalog)).tools, catalog)
})

test('fork-seeded subagents remain outside fresh mode', async () => {
  const { listeners } = register({ subagentMode: 'fresh' })
  const agent = makeAgent([], {
    origin: 'subagent',
    delegationDepth: 1,
    seedLength: 12,
  })
  assert.equal((await assemble(listeners['system-prompt/assemble'], agent, catalog)).tools, catalog)
})

test('automatic instruction and skill messages are suppressed only before tool use', async () => {
  const { listeners, hookOptions } = register()
  assert.deepEqual(hookOptions['agent/pre-step'], { prepend: true })
  const messages = [
    { id: 'user', source: { kind: 'user' } },
    { id: 'instructions', source: { kind: 'agent-instructions' } },
    { id: 'skills', source: { kind: 'skill-catalog' } },
    { id: 'gesture', source: { kind: 'skill-invocation' } },
  ]
  const agent = makeAgent()
  const before = await listeners['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages }))
  assert.deepEqual(before.messages.map(message => message.id), ['user', 'gesture'])

  listeners['session/event'](agent.session, { type: 'tool/call', seq: 1, data: { name: 'bash' } })
  const after = await listeners['agent/pre-step']({ agent }, async () => ({ kind: 'enter', messages }))
  assert.equal(after.messages, messages)
})

test('missing bootstrap tools fail open instead of bricking the session', async () => {
  const { listeners, warnings } = register()
  const incomplete = [{ name: 'bash' }, { name: 'read' }]
  const result = await assemble(listeners['system-prompt/assemble'], makeAgent(), incomplete)
  assert.equal(result.tools, incomplete)
  assert.equal(warnings.length, 1)
})

test('a fresh child with a restricted bootstrap pair fails loud', async () => {
  const { listeners } = register({ subagentMode: 'fresh' })
  const incomplete = [{ name: 'bash' }, { name: 'read' }]
  await assert.rejects(
    assemble(
      listeners['system-prompt/assemble'],
      makeAgent([], { origin: 'subagent', delegationDepth: 1 }),
      incomplete,
    ),
    /missing required bootstrap tools/u,
  )
})

test('invalid configuration is rejected at mount time', () => {
  assert.throws(() => register({ bootstrapTools: [] }), /bootstrapTools/)
  assert.throws(() => register({ includeSubagents: 'yes' }), /includeSubagents/)
  assert.throws(() => register({ subagentMode: 'spawn' }), /subagentMode/)
  assert.throws(
    () => register({ subagentMode: 'fresh', includeSubagents: true }),
    /mutually exclusive/,
  )
  assert.throws(() => register({ promoteOn: 'tool-call' }), /unknown config key/)
})
