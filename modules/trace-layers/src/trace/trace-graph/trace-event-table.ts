import * as arrow from 'apache-arrow';

import {deserializeArrowTraceJson, serializeArrowTraceJson} from '../ingestion/arrow-trace-json';
import {isEventRef} from './trace-id-encoder';

import type {EventRef} from './trace-id-encoder';
import type {TraceEvent, TraceEventId} from './trace-types';

/** Apache Arrow schema describing the graph-global trace event table. */
export type ArrowTraceEventTable = arrow.Table<{
  /** Optional canonical chunk-row runtime ref for the event row. */
  eventRef: arrow.Uint64;
  /** Stable graph-global event identifier. */
  eventId: arrow.Utf8;
  /** Event display name. */
  name: arrow.Utf8;
  /** Event timestamp in milliseconds. */
  atTimeMs: arrow.Float64;
  /** Optional serialized user data payload. */
  userDataJson: arrow.Utf8;
}>;

/** Serialized Arrow row used to populate an {@link ArrowTraceEventTable}. */
export type TraceEventArrowRow = {
  /** Optional canonical chunk-row runtime ref for this event row. */
  eventRef?: EventRef | null;
  /** Stable graph-global event identifier. */
  eventId: string;
  /** Event display name. */
  name: string;
  /** Event timestamp in milliseconds. */
  atTimeMs: number;
  /** Optional serialized user data payload. */
  userDataJson: string | null;
};

/** Column-oriented Arrow payload used to build an {@link ArrowTraceEventTable}. */
export type TraceEventArrowColumns = {
  /** Optional canonical chunk-row runtime refs in table row order. */
  eventRef?: Array<EventRef | null>;
  /** Stable graph-global event identifiers in table row order. */
  eventId: string[];
  /** Event display names in table row order. */
  name: string[];
  /** Event timestamps in table row order. */
  atTimeMs: number[];
  /** Optional serialized user data payloads in table row order. */
  userDataJson: Array<string | null>;
};

/** Empty shared event table reused by traces without graph-global events. */
export const EMPTY_ARROW_TRACE_EVENT_TABLE = buildArrowTraceEventTableFromColumns({
  eventRef: [],
  eventId: [],
  name: [],
  atTimeMs: [],
  userDataJson: []
});

/** Builds one graph-global Arrow event table from pre-serialized row objects. */
export function buildArrowTraceEventTableFromRows(
  rows: ReadonlyArray<TraceEventArrowRow>
): ArrowTraceEventTable {
  return buildArrowTraceEventTableFromColumns(rowsToTraceEventArrowColumns(rows));
}

/** Builds one graph-global Arrow event table from column-oriented event payloads. */
export function buildArrowTraceEventTableFromColumns(
  columns: TraceEventArrowColumns
): ArrowTraceEventTable {
  return new arrow.Table({
    eventRef: buildNullableEventRefVector(columns.eventRef, columns.eventId.length),
    eventId: arrow.vectorFromArray(columns.eventId, new arrow.Utf8()),
    name: arrow.vectorFromArray(columns.name, new arrow.Utf8()),
    atTimeMs: arrow.vectorFromArray(columns.atTimeMs, new arrow.Float64()),
    userDataJson: arrow.vectorFromArray(columns.userDataJson, new arrow.Utf8())
  }) as ArrowTraceEventTable;
}

/** Serializes plain shared trace events into the shared graph-global Arrow event table. */
export function buildArrowTraceEventTableFromEvents(
  events: ReadonlyArray<TraceEvent>
): ArrowTraceEventTable {
  return buildArrowTraceEventTableFromColumns({
    eventRef: events.map(event => event.eventRef ?? null),
    eventId: events.map(event => String(event.eventId)),
    name: events.map(event => event.name),
    atTimeMs: events.map(event => event.atTimeMs),
    userDataJson: events.map(event =>
      event.userData ? serializeArrowTraceJson(event.userData) : null
    )
  });
}

/** Materializes the compatibility event map from the shared graph-global Arrow event table. */
export function buildTraceEventMap(
  events: Readonly<ArrowTraceEventTable>
): Readonly<Record<TraceEventId, TraceEvent>> {
  const eventRefColumn = events.getChild('eventRef');
  const eventIdColumn = events.getChild('eventId');
  const nameColumn = events.getChild('name');
  const atTimeMsColumn = events.getChild('atTimeMs');
  const userDataJsonColumn = events.getChild('userDataJson');
  const eventMap = {} as Record<TraceEventId, TraceEvent>;

  for (let rowIndex = 0; rowIndex < events.numRows; rowIndex += 1) {
    const eventId = eventIdColumn?.get(rowIndex) as TraceEventId | null;
    if (!eventId) {
      continue;
    }
    const name = (nameColumn?.get(rowIndex) as string | null) ?? '';
    const atTimeMs = Number(atTimeMsColumn?.get(rowIndex) ?? Number.NaN);
    const userDataJson = (userDataJsonColumn?.get(rowIndex) as string | null) ?? null;
    const eventRefValue = Number(eventRefColumn?.get(rowIndex) ?? Number.NaN);
    eventMap[eventId] = {
      type: 'trace-event',
      ...(isEventRef(eventRefValue) ? {eventRef: eventRefValue} : {}),
      eventId,
      name,
      atTimeMs,
      userData: deserializeArrowTraceJson<Record<string, unknown>>(userDataJson)
    };
  }

  return eventMap;
}

function rowsToTraceEventArrowColumns(
  rows: ReadonlyArray<TraceEventArrowRow>
): TraceEventArrowColumns {
  return {
    eventRef: rows.map(row => row.eventRef ?? null),
    eventId: rows.map(row => row.eventId),
    name: rows.map(row => row.name),
    atTimeMs: rows.map(row => row.atTimeMs),
    userDataJson: rows.map(row => row.userDataJson)
  };
}

/**
 * Builds one nullable Arrow `Uint64` event-ref vector aligned with the event row count.
 */
function buildNullableEventRefVector(
  eventRefs: ReadonlyArray<EventRef | null> | undefined,
  rowCount: number
): arrow.Vector<arrow.Uint64> {
  const values = Array.from({length: rowCount}, (_, rowIndex) => {
    const eventRef = eventRefs?.[rowIndex] ?? null;
    return eventRef == null ? null : BigInt(eventRef);
  });
  return arrow.vectorFromArray(values, new arrow.Uint64());
}
