/**
 * Optional Git Bash compatibility tool for native Windows experiments.
 * @module dsh-epoch-reanchor/windows-bash
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
export const name = 'epoch-windows-git-bash';
export const inject = ['tools', 'subprocess'];
const DEFAULT_DESCRIPTION = [
    'Run commands in a bash shell.',
    '* This optional native-Windows compatibility backend starts a fresh Git Bash process for every call.',
    '* Shell state does not persist across calls, and Windows path/process semantics still apply.',
    '* This mode is not an exact reproduction of the official Linux RL environment.',
    '* The command parameter does not need to be XML-escaped.',
    '* Keep output bounded and run long-lived processes in the background.',
].join('\n');
export const Config = z.object({
    bashPath: z.string().default('bash'),
    timeoutMs: z.number().step(1).min(1).default(300_000),
    maxOutputChars: z.number().step(1).min(1).default(16_000),
    description: z.string().default(DEFAULT_DESCRIPTION),
});
export function apply(ctx, config) {
    const bashPath = config.bashPath ?? 'bash';
    const timeoutMs = config.timeoutMs ?? 300_000;
    const maxOutputChars = config.maxOutputChars ?? 16_000;
    const description = config.description ?? DEFAULT_DESCRIPTION;
    ctx.tools.register(defineTool({
        name: 'bash',
        description,
        parameters: {
            command: {
                type: 'string',
                required: true,
                description: 'The bash command to run. Relative path is preferred in the command.',
            },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args, exec) {
            if (args.command.trim().length === 0)
                throw new Error('command must be a non-empty string');
            const executable = await ctx.subprocess.resolveExecutable(bashPath, undefined, exec.signal);
            const deadline = AbortSignal.timeout(timeoutMs);
            const signal = AbortSignal.any([exec.signal, deadline]);
            const handle = ctx.subprocess.spawn({
                argv: [executable, '-c', args.command],
                cwd: exec.agent?.session.header.cwd ?? process.cwd(),
                stdio: {
                    stdin: 'ignore',
                    stdout: { maxBytes: Math.max(maxOutputChars * 4, 65_536) },
                    stderr: { maxBytes: Math.max(maxOutputChars * 4, 65_536) },
                },
                signal,
                graceMs: 3_000,
            });
            const outcome = await handle.done;
            const stdout = handle.collected.stdout?.readFrom(0).text ?? '';
            const stderr = handle.collected.stderr?.readFrom(0).text ?? '';
            const combined = [stdout, stderr].filter(Boolean).join('\n');
            const marker = outcome.signal !== null
                ? `[shell killed by signal: ${outcome.signal}]`
                : outcome.exitCode !== null && outcome.exitCode !== 0
                    ? `[exit code: ${outcome.exitCode}]`
                    : '';
            const rendered = [combined, marker].filter(Boolean).join('\n');
            if (rendered.length <= maxOutputChars)
                return rendered;
            return rendered.slice(0, maxOutputChars)
                + '\n<response clipped><NOTE>Command output exceeded the compatibility-mode limit.</NOTE>';
        },
        presentCall: args => ({ card: 'terminal', title: args.command }),
    }));
}
//# sourceMappingURL=windows-bash.js.map