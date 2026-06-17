import fs from 'fs';
import os from 'os';
import path from 'path';
import * as protobuf from 'protobufjs';
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

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracevis-perfetto-'));
    const file = path.join(directory, 'test-trace.pb');

    try {
      fs.writeFileSync(file, buffer);

      const readBuffer = fs.readFileSync(file);
      const result = parsePerfettoTrace(new Uint8Array(readBuffer));
      expect(result.packet.length).toBe(1);
      expect(result.packet[0].data).toBeDefined();

      // console.error(JSON.stringify(result, null, 2));
    } finally {
      fs.rmSync(directory, {recursive: true, force: true});
    }
  });
});
