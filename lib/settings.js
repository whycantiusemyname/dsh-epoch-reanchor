/**
 * Restart-scoped user settings shared by the packaged agent presets.
 * @module dsh-epoch-reanchor/settings
 */
import { Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
/** Settings namespace stored in the shared DSH settings document. */
export const EPOCH_REANCHOR_SETTINGS_NAMESPACE = settingsNamespace('dsh-epoch-reanchor');
/** Restart-scoped settings schema. */
export const Config = z.object({
    windowsShell: z.union(['pwsh', 'git-bash'])
        .default('pwsh')
        .description('Windows bootstrap shell. pwsh follows the official DSH Windows composition; git-bash is an experimental compatibility option.'),
    gitBashPath: z.string()
        .default('bash')
        .description('Git Bash executable name or absolute path; used only when windowsShell is git-bash.'),
});
function validateConfig(config) {
    if ((config.gitBashPath ?? '').trim().length === 0) {
        throw new Error('dsh-epoch-reanchor: gitBashPath must be a non-empty executable name or path');
    }
}
/**
 * Process-global snapshot consumed by each agent-local preset composition.
 * Settings changes are intentionally read only when DSH starts again.
 */
export class EpochReanchorSettings extends Service {
    static inject = ['settings'];
    windowsShell;
    gitBashPath;
    constructor(ctx) {
        super(ctx, 'epochReanchorSettings');
        const scope = ctx.settings.register(EPOCH_REANCHOR_SETTINGS_NAMESPACE, Config, {
            applies: 'restart',
            validate: validateConfig,
        });
        const resolved = scope.get();
        this.windowsShell = resolved.windowsShell;
        this.gitBashPath = resolved.gitBashPath;
    }
}
export default EpochReanchorSettings;
//# sourceMappingURL=settings.js.map