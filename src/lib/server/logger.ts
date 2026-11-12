/* src/lib/server/logger.ts
 * MIT — (c) Doughmination System®
 */

type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, scope: string, message: string, error?: unknown): void {
	const line = `${new Date().toISOString()} [${level}] [${scope}] ${message}`;
	const detail = error instanceof Error ? ` (${error.message})` : '';

	console[level](line + detail);
}

export function createLogger(scope: string) {
	return {
		info: (message: string) => write('info', scope, message),
		warn: (message: string, error?: unknown) => write('warn', scope, message, error),
		error: (message: string, error?: unknown) => write('error', scope, message, error)
	};
}

export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
