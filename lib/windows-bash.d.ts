/**
 * Optional Git Bash compatibility tool for native Windows experiments.
 * @module dsh-epoch-reanchor/windows-bash
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "epoch-windows-git-bash";
export declare const inject: string[];
export interface Config {
    /** Executable name resolved through PATH, or an absolute Git Bash path. */
    bashPath?: string;
    timeoutMs?: number;
    maxOutputChars?: number;
    description?: string;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=windows-bash.d.ts.map