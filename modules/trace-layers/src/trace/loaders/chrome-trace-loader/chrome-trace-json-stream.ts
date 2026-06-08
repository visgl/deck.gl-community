import type {ChromeTraceEventSchema, ChromeTraceFileSchema} from './chrome-trace-schema';

/**
 * Incremental tokenizer state for one streamed Chrome trace JSON file.
 */
export type ChromeTraceFileTokenizer = {
  /** Remaining undecoded text buffer. */
  buffer: string;
  /** Whether parsing has reached the `traceEvents` array payload. */
  insideTraceEventsArray: boolean;
  /** Whether parsing has already consumed the closing `traceEvents` array bracket. */
  finishedTraceEventsArray: boolean;
  /** Whether parsing is currently inside one JSON string literal. */
  insideString: boolean;
  /** Whether the previous character escaped the current one. */
  escapingCharacter: boolean;
  /** Current object nesting depth within the trace-events array. */
  objectDepth: number;
  /** Buffer index where the current event object started, when present. */
  objectStartIndex: number | null;
  /** Optional top-level display time unit discovered from the buffered JSON. */
  displayTimeUnit?: string;
};

/**
 * Creates one incremental tokenizer for a chunked Chrome trace JSON file.
 */
export function createChromeTraceFileTokenizer(
  displayTimeUnit: string | undefined
): ChromeTraceFileTokenizer {
  return {
    buffer: '',
    insideTraceEventsArray: false,
    finishedTraceEventsArray: false,
    insideString: false,
    escapingCharacter: false,
    objectDepth: 0,
    objectStartIndex: null,
    displayTimeUnit
  };
}

/**
 * Appends one text or binary chunk into the tokenizer and returns any complete parsed events.
 */
export function appendChromeTraceFileChunk(
  tokenizer: ChromeTraceFileTokenizer,
  chunk: string | Uint8Array | ArrayBuffer
): ChromeTraceEventSchema[] {
  tokenizer.buffer += decodeChromeTraceChunk(chunk);
  maybeExtractChromeTraceDisplayTimeUnit(tokenizer);
  return extractChromeTraceEventsFromTokenizer(tokenizer);
}

/**
 * Attempts to parse one complete Chrome trace JSON string without throwing on partial input.
 */
export function tryParseChromeTraceFileText(text: string): ChromeTraceFileSchema | null {
  try {
    const parsed = JSON.parse(text) as ChromeTraceFileSchema;
    return Array.isArray(parsed?.traceEvents) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Decodes one streamed chunk into UTF-8 text.
 */
function decodeChromeTraceChunk(chunk: string | Uint8Array | ArrayBuffer): string {
  if (typeof chunk === 'string') {
    return chunk;
  }
  if (chunk instanceof Uint8Array) {
    return new TextDecoder().decode(chunk);
  }
  return new TextDecoder().decode(new Uint8Array(chunk));
}

/**
 * Extracts the optional top-level display time unit from the buffered JSON prefix.
 */
function maybeExtractChromeTraceDisplayTimeUnit(tokenizer: ChromeTraceFileTokenizer): void {
  if (tokenizer.displayTimeUnit) {
    return;
  }
  const match = tokenizer.buffer.match(/"displayTimeUnit"\s*:\s*"([^"]+)"/);
  if (match?.[1]) {
    tokenizer.displayTimeUnit = match[1];
  }
}

/**
 * Extracts complete event objects from the tokenizer buffer while preserving any partial tail.
 */
function extractChromeTraceEventsFromTokenizer(
  tokenizer: ChromeTraceFileTokenizer
): ChromeTraceEventSchema[] {
  const parsedEvents: ChromeTraceEventSchema[] = [];

  if (tokenizer.finishedTraceEventsArray) {
    tokenizer.buffer = '';
    return parsedEvents;
  }
  if (!tokenizer.insideTraceEventsArray) {
    const traceEventsKeyIndex = tokenizer.buffer.indexOf('"traceEvents"');
    const traceEventsArrayIndex =
      traceEventsKeyIndex >= 0 ? tokenizer.buffer.indexOf('[', traceEventsKeyIndex) : -1;
    if (traceEventsArrayIndex < 0) {
      return parsedEvents;
    }
    tokenizer.buffer = tokenizer.buffer.slice(traceEventsArrayIndex + 1);
    tokenizer.insideTraceEventsArray = true;
  }

  let trimIndex = 0;
  for (let index = 0; index < tokenizer.buffer.length; index += 1) {
    const character = tokenizer.buffer[index];

    if (tokenizer.insideString) {
      if (tokenizer.escapingCharacter) {
        tokenizer.escapingCharacter = false;
      } else if (character === '\\') {
        tokenizer.escapingCharacter = true;
      } else if (character === '"') {
        tokenizer.insideString = false;
      }
      continue;
    }

    if (character === '"') {
      tokenizer.insideString = true;
      continue;
    }

    if (tokenizer.objectStartIndex == null) {
      if (character === '{') {
        tokenizer.objectStartIndex = index;
        tokenizer.objectDepth = 1;
      } else if (character === ']') {
        tokenizer.finishedTraceEventsArray = true;
        trimIndex = index + 1;
        break;
      }
      continue;
    }

    if (character === '{') {
      tokenizer.objectDepth += 1;
      continue;
    }
    if (character !== '}') {
      continue;
    }

    tokenizer.objectDepth -= 1;
    if (tokenizer.objectDepth !== 0) {
      continue;
    }

    const eventJson = tokenizer.buffer.slice(tokenizer.objectStartIndex, index + 1);
    parsedEvents.push(JSON.parse(eventJson) as ChromeTraceEventSchema);
    trimIndex = index + 1;
    tokenizer.objectStartIndex = null;
  }

  if (tokenizer.objectStartIndex != null) {
    tokenizer.buffer = tokenizer.buffer.slice(tokenizer.objectStartIndex);
    tokenizer.objectStartIndex = 0;
    return parsedEvents;
  }

  tokenizer.buffer = tokenizer.buffer.slice(trimIndex);
  return parsedEvents;
}
