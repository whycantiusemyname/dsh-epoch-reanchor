/**
 * Restart-scoped user settings shared by the packaged agent presets.
 * @module dsh-epoch-reanchor/settings
 */
import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** Windows shell exposed during an epoch's Minimal bootstrap phase. */
export type WindowsShell = 'pwsh' | 'git-bash';
/** User-editable settings for the packaged presets. */
export interface Config {
    /** Official native PowerShell by default; optional Git Bash compatibility mode. */
    windowsShell?: WindowsShell;
    /** Executable name or absolute path used only when windowsShell is `git-bash`. */
    gitBashPath?: string;
}
/** Settings namespace stored in the shared DSH settings document. */
export declare const EPOCH_REANCHOR_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** Restart-scoped settings schema. */
export declare const Config: z<Config>;
declare module '@deepseek-ai/cordis' {
    interface Context {
        epochReanchorSettings: EpochReanchorSettings;
    }
}
/**
 * Process-global snapshot consumed by each agent-local preset composition.
 * Settings changes are intentionally read only when DSH starts again.
 */
export declare class EpochReanchorSettings extends Service {
    static inject: string[];
    readonly windowsShell: WindowsShell;
    readonly gitBashPath: string;
    constructor(ctx: Context);
}
export default EpochReanchorSettings;
//# sourceMappingURL=settings.d.ts.map