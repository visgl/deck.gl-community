import {afterEach, beforeEach, expect, vi} from 'vitest';

const CONSOLE_METHODS = ['debug', 'error', 'info', 'log', 'warn'] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];
type TestLog = {enable?: (enabled?: boolean) => unknown};
type TraceTestGlobal = typeof globalThis & {
  traceLayers?: {log?: TestLog};
  tracevis?: {log?: TestLog};
};

let unexpectedConsoleMessages: string[] = [];
let isTraceLayersTest = false;

beforeEach(() => {
  isTraceLayersTest = isTraceLayersTestPath(getCurrentTestPath());
  if (!isTraceLayersTest) {
    return;
  }

  unexpectedConsoleMessages = [];

  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      unexpectedConsoleMessages.push(formatConsoleMessage(method, args));
    });
  }

  const traceTestGlobal = globalThis as TraceTestGlobal;
  traceTestGlobal.traceLayers?.log?.enable?.(false);
  traceTestGlobal.tracevis?.log?.enable?.(false);
});

afterEach(() => {
  if (!isTraceLayersTest) {
    return;
  }

  const messages = unexpectedConsoleMessages;
  vi.restoreAllMocks();
  if (messages.length > 0) {
    throw new Error(`Unexpected console output:\n${messages.join('\n')}`);
  }
});

function getCurrentTestPath(): string {
  return expect.getState().testPath ?? '';
}

function isTraceLayersTestPath(testPath: string): boolean {
  return (
    testPath.includes('/modules/trace-layers/') || testPath.includes('/examples/trace-layers/')
  );
}

function formatConsoleMessage(method: ConsoleMethod, args: readonly unknown[]): string {
  return `${method}: ${args.map(formatConsoleArgument).join(' ')}`;
}

function formatConsoleArgument(value: unknown): string {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
