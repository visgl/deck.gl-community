import protobuf from 'protobufjs/dist/light/protobuf.js';
import {describe, expect, it} from 'vitest';

import {parsePerfettoTrace} from './parse-perfetto-trace';
import traceJson from './perfetto_trace.json';

const root = protobuf.Root.fromJSON(traceJson as unknown as protobuf.INamespace);
const Trace = root.lookupType('perfetto.protos.Trace');

describe('parsePerfettoTrace', () => {
  it('decodes a minimal trace file', () => {
    const message = Trace.create({
      packet: [{data: Buffer.from('hello')}]
    });
    const buffer = Trace.encode(message).finish();

    const result = parsePerfettoTrace(buffer);
    expect(result.packet.length).toBe(1);
    expect(result.packet[0].data).toBeDefined();
  });
});
