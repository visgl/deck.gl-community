import {type TraceObject} from '../trace-graph/trace-types';

/** Return default JSON for a trace object  */
export function getJSONForTraceObject(
  object?: TraceObject | null,
  /** Text to copy to cliboard */
  getJSON?: (object?: TraceObject) => Record<string, unknown> | string
): string {
  if (!object) {
    return '';
  }

  // Simple objects may just add a copyText property
  if ('copyText' in object && typeof object.copyText === 'string') {
    return object.copyText;
  }

  if (getJSON) {
    try {
      const json = getJSON(object);
      return JSON.stringify(json, null, 2);
    } catch (e) {
      console.error('Failed to get JSON for trace object:', e);
      return 'Error getting JSON for trace object';
    }
  }

  try {
    return JSON.stringify(object, null, 2);
  } catch (e) {
    console.error('Failed to stringify object for tooltip:', e);
    return 'Error converting object to JSON';
  }
}
