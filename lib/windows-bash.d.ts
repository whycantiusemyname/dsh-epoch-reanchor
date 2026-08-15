import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "epoch-windows-bash";
export declare const inject: string[];
export interface Config {
    bashPath?: string;
    timeoutMs?: number;
    maxOutputChars?: number;
    description?: string;
}
export declare const Config: z<Config>;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=windows-bash.d.ts.map