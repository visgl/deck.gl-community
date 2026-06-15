# Perfetto Trace Parser

This module provides minimal utilities to read Perfetto protobuf traces. It uses
[`protobufjs`](https://github.com/protobufjs/protobuf.js) and a JSON descriptor
created from the `perfetto_trace.proto` schema.

The parser exposes a `parsePerfettoTrace` helper (decode a full protobuf trace
into a JavaScript object) and `parsePerfettoTraceToArrow` (stream TracePackets
into Apache Arrow `RecordBatch`es).

To regenerate the JSON descriptor:

```bash
npx pbjs -t json path/to/perfetto_trace.proto -o perfetto_trace.json
```
