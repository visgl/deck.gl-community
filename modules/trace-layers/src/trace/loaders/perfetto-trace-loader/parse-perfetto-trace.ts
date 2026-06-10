import * as protobuf from 'protobufjs';

import PERFETTO_JSON from './perfetto_trace.json';

// The JSON descriptor is generated from perfetto_trace.proto using pbjs.
// We keep it in the same directory for simplicity.
const root = protobuf.Root.fromJSON(PERFETTO_JSON);

const Trace = root.lookupType('perfetto.protos.Trace');

export function parsePerfettoTrace(uint8Array: Uint8Array) {
  const message = Trace.decode(uint8Array);
  return Trace.toObject(message, {
    longs: String,
    enums: String,
    bytes: String
  });
}
