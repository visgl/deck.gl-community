import type {TraceColor, TraceColorScheme} from '../trace-style/trace-color-scheme';

export type ChromeTraceColorSchemeOptions = {
  /** Optional identifier for the scheme instance. */
  id?: string;
  /** Optional user-facing label for the scheme. */
  name?: string;
  /** Optional selector subtext explaining how the scheme colors spans. */
  description?: string;
};

const CHROME_COLOR_KEYS = ['color', 'streamColor', 'rankColor'] as const;

function isFiniteColorComponent(component: unknown): component is number {
  return typeof component === 'number' && Number.isFinite(component);
}

function coerceColor(value: unknown): TraceColor | undefined {
  if (!Array.isArray(value) || (value.length !== 3 && value.length !== 4)) {
    return undefined;
  }

  const [r, g, b, a] = value;
  if (![r, g, b, a].every(isFiniteColorComponent)) {
    return undefined;
  }

  return [r, g, b, a ?? 255] as TraceColor;
}

export function getColorFromUserData(userData?: Record<string, unknown>): TraceColor | undefined {
  if (!userData) {
    return undefined;
  }

  for (const key of CHROME_COLOR_KEYS) {
    const parsed = coerceColor(userData[key]);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

export function createChromeTraceColorScheme(
  options: ChromeTraceColorSchemeOptions = {}
): TraceColorScheme {
  const {
    id = 'chrome-trace',
    name = 'Chrome Trace',
    description = 'Color spans with colors embedded in Chrome Trace metadata.'
  } = options;

  return {
    id,
    name,
    description,
    getSpanFillColor: ({span}) => getColorFromUserData(span.userData),
    getThreadColor: ({thread}) => getColorFromUserData(thread?.userData),
    getProcessBackgroundColor: ({process}) => getColorFromUserData(process?.userData)
  };
}
