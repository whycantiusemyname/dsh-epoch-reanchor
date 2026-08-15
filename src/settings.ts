/**
 * Restart-scoped user settings shared by the packaged agent presets.
 * @module dsh-epoch-reanchor/settings
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Windows shell exposed during an epoch's Minimal bootstrap phase. */
export type WindowsShell = 'pwsh' | 'git-bash'

/** User-editable settings for the packaged presets. */
export interface Config {
  /** Official native PowerShell by default; optional Git Bash compatibility mode. */
  windowsShell?: WindowsShell
  /** Executable name or absolute path used only when windowsShell is `git-bash`. */
  gitBashPath?: string
}

interface ResolvedConfig {
  windowsShell: WindowsShell
  gitBashPath: string
}

/** Settings namespace stored in the shared DSH settings document. */
export const EPOCH_REANCHOR_SETTINGS_NAMESPACE = settingsNamespace('dsh-epoch-reanchor')

/** Restart-scoped settings schema. */
export const Config: z<Config> = z.object({
  windowsShell: z.union(['pwsh', 'git-bash'])
    .default('pwsh')
    .description('Windows bootstrap shell. pwsh follows the official DSH Windows composition; git-bash is an experimental compatibility option.'),
  gitBashPath: z.string()
    .default('bash')
    .description('Git Bash executable name or absolute path; used only when windowsShell is git-bash.'),
})

function validateConfig(config: Config): void {
  if ((config.gitBashPath ?? '').trim().length === 0) {
    throw new Error('dsh-epoch-reanchor: gitBashPath must be a non-empty executable name or path')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    epochReanchorSettings: EpochReanchorSettings
  }
}

/**
 * Process-global snapshot consumed by each agent-local preset composition.
 * Settings changes are intentionally read only when DSH starts again.
 */
export class EpochReanchorSettings extends Service {
  static inject = ['settings']

  readonly windowsShell: WindowsShell
  readonly gitBashPath: string

  constructor(ctx: Context) {
    super(ctx, 'epochReanchorSettings')
    const scope = ctx.settings.register(EPOCH_REANCHOR_SETTINGS_NAMESPACE, Config, {
      applies: 'restart',
      validate: validateConfig,
    })
    const resolved = scope.get() as ResolvedConfig
    this.windowsShell = resolved.windowsShell
    this.gitBashPath = resolved.gitBashPath
  }
}

export default EpochReanchorSettings
