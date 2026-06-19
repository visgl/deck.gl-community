# Tracevis Example

This standalone drag-and-drop example shows how to build a custom trace viewer on top of
`@deck.gl-community/trace-layers`. It stays package-local and does not import product app modules,
backend clients, or app-owned UI glue.

## File Formats

Tracevis is intended to support open trace formats including:

- Chrome Traces (JSON)
- Perfetto Traces (protobuf)

## Built-in Examples

The trace catalog sidebar includes small synthetic examples below the upload controls. They exercise
Chrome trace loading and Tracevis-native graph features such as manual span layout via
`spanLayout: 'manual'`, `layoutTopY`, and `layoutHeight`.

## Streaming Mode

Streaming data loaded incrementally from a live feed is not a focus of this first standalone example.
