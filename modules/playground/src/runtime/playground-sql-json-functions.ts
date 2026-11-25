// deck.gl-community
// SPDX-License-Identifier: MIT
import {Field, Float64, Utf8, vectorFromArray} from 'apache-arrow';
import type {ScalarFunction} from '@math.gl/sql/arrow';

/** Typed accessors for lossless JSON-backed upload columns; no SQL or code evaluation. */
export const PLAYGROUND_SQL_JSON_FUNCTIONS: readonly ScalarFunction[] = [
  createJsonFunction('JSON_VALUE', new Utf8(), value =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : null
  ),
  createJsonFunction('JSON_NUMBER', new Float64(), value =>
    typeof value === 'number' && Number.isFinite(value) ? value : null
  )
];

function createJsonFunction(
  name: string,
  type: Utf8 | Float64,
  convert: (value: unknown) => string | number | null
): ScalarFunction {
  const evaluate = (json: unknown, path: unknown) => {
    if (json === null || path === null) return null;
    if (typeof json !== 'string' || typeof path !== 'string')
      throw new Error(`${name} requires JSON and path strings`);
    if (!/^\$(?:\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$/.test(path)) {
      throw new Error(`${name} requires a path such as $.properties.value or $.coordinates[0]`);
    }
    let value: unknown = JSON.parse(json);
    for (const key of path.match(/[a-zA-Z_][a-zA-Z0-9_]*|\d+/g) ?? []) {
      if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return null;
      value = (value as Record<string, unknown>)[key];
    }
    return convert(value);
  };
  return {
    kind: 'scalar',
    name,
    prototypes: [
      {
        arguments: [new Field('json', new Utf8(), true), new Field('path', new Utf8(), true)],
        result: new Field(name.toLowerCase(), type, true),
        evaluateScalar: evaluate,
        evaluate([json, path], {length, activeRows}) {
          return vectorFromArray(
            Array.from({length}, (_, index) =>
              activeRows[index] ? evaluate(json.get(index), path.get(index)) : null
            ),
            type
          );
        }
      }
    ]
  };
}
