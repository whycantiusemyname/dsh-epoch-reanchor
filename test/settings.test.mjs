import assert from 'node:assert/strict'
import test from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import EpochReanchorSettings, {
  Config,
  EPOCH_REANCHOR_SETTINGS_NAMESPACE,
} from '../lib/settings.js'

test('Windows shell settings default to official pwsh and PATH-resolved Git Bash', () => {
  assert.deepEqual(Config({}), {
    windowsShell: 'pwsh',
    gitBashPath: 'bash',
  })
})

test('the settings service registers one restart-scoped namespace and snapshots it', async () => {
  const ctx = new Context()
  let current = {
    windowsShell: 'git-bash',
    gitBashPath: 'C:\\Program Files\\Git\\bin\\bash.exe',
  }
  let registration
  ctx.provide('settings', {
    register(namespace, schema, options) {
      registration = { namespace, schema, options }
      return { get: () => schema(current) }
    },
  })

  const fiber = ctx.plugin(EpochReanchorSettings)
  await fiber
  try {
    assert.equal(registration.namespace, EPOCH_REANCHOR_SETTINGS_NAMESPACE)
    assert.equal(registration.options.applies, 'restart')
    assert.equal(ctx.epochReanchorSettings.windowsShell, 'git-bash')
    assert.equal(ctx.epochReanchorSettings.gitBashPath, current.gitBashPath)

    current = { windowsShell: 'pwsh', gitBashPath: 'bash' }
    assert.equal(ctx.epochReanchorSettings.windowsShell, 'git-bash')
    assert.throws(
      () => registration.options.validate({ windowsShell: 'git-bash', gitBashPath: '   ' }),
      /gitBashPath/,
    )
  } finally {
    await ctx.fiber.dispose()
  }
})
