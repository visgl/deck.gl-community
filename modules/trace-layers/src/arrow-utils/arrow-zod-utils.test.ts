import * as arrow from 'apache-arrow';
import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {validateArrowTableAgainstZod} from './arrow-zod-utils';

function expectOk(result: {ok: boolean; issues: any[]}) {
  if (!result.ok) {
    // Show readable error list
    const msg = result.issues
      .map(i => `${(i.path || []).join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    expect.fail(`Expected ok=true, but had issues:\n${msg}`);
  }
}
function expectNotOk(result: {ok: boolean; issues: any[]}) {
  expect(result.ok).toBe(false);
  expect(result.issues.length).toBeGreaterThan(0);
}
function hasIssue(result: {issues: any[]}, field: string, includes?: string) {
  const hit = result.issues.find(
    i =>
      Array.isArray(i.path) &&
      i.path[0] === field &&
      (!includes || `${i.message}`.includes(includes))
  );
  expect(
    hit,
    `Expected an issue on "${field}"${includes ? ` containing "${includes}"` : ''}`
  ).toBeTruthy();
}

describe('validateArrowTableAgainstZod', () => {
  it('matches a simple schema (number/string/bool)', () => {
    const table = arrow.tableFromJSON([
      {id: 1, name: 'Alice', active: true},
      {id: 2, name: 'Bob', active: false}
    ]);
    const Row = z.object({
      id: z.number(),
      name: z.string(),
      active: z.boolean()
    });

    const res = validateArrowTableAgainstZod(table, Row);
    expectOk(res);
  });

  it('flags a missing required Zod field', () => {
    const table = arrow.tableFromJSON([{id: 1, name: 'A'}]);
    const Row = z.object({
      id: z.number(),
      name: z.string(),
      age: z.number() // required, not in table
    });

    const res = validateArrowTableAgainstZod(table, Row);
    expectNotOk(res);
    hasIssue(res, 'age', 'Missing Arrow column');
  });

  it('allows a missing optional Zod field by default', () => {
    const table = arrow.tableFromJSON([{id: 1, name: 'A'}]);
    const Row = z.object({
      id: z.number(),
      name: z.string(),
      age: z.number().optional()
    });

    const res = validateArrowTableAgainstZod(table, Row, {
      allowMissingOptionalFields: true
    });
    expectOk(res);
  });

  it('flags extra Arrow columns when allowExtraColumns=false', () => {
    const table = arrow.tableFromJSON([{id: 1, name: 'A'}]);
    const Row = z.object({id: z.number()});

    const res = validateArrowTableAgainstZod(table, Row, {
      allowExtraColumns: false
    });
    expectNotOk(res);
    hasIssue(res, 'name', 'Extra Arrow column');
  });

  it('numberMode=int-only rejects float columns and float-only accepts them', () => {
    const table = arrow.tableFromJSON([{value: 1.5}, {value: 2.25}]);
    const Row = z.object({value: z.number()});

    const resIntOnly = validateArrowTableAgainstZod(table, Row, {numberMode: 'int-only'});
    expectNotOk(resIntOnly);
    hasIssue(resIntOnly, 'value', 'Type mismatch');

    const resFloatOnly = validateArrowTableAgainstZod(table, Row, {numberMode: 'float-only'});
    expectOk(resFloatOnly);
  });

  it('z.bigint maps to Arrow 64-bit ints', () => {
    // Arrow JS supports BigInt inputs -> Int64/Uint64 columns
    const table = arrow.tableFromJSON([{id: 1n}, {id: 2n}]);
    const Row = z.object({id: z.bigint()});

    const res = validateArrowTableAgainstZod(table, Row);
    expectOk(res);
  });

  it('z.date maps to Arrow Timestamp/Date types', () => {
    const table = arrow.tableFromJSON([
      {ts: new Date('2024-01-01T00:00:00Z')},
      {ts: new Date('2024-01-02T00:00:00Z')}
    ]);
    const Row = z.object({ts: z.date()});

    const res = validateArrowTableAgainstZod(table, Row);
    expectOk(res);
  });

  it('z.array(T) maps to Arrow List<T>', () => {
    const table = arrow.tableFromJSON([{nums: [1, 2, 3]}, {nums: [4, 5]}]);
    const Row = z.object({nums: z.array(z.number())});

    const res = validateArrowTableAgainstZod(table, Row);
    expectOk(res);
  });

  it('nested z.object maps to Arrow Struct', () => {
    const table = arrow.tableFromJSON([{user: {name: 'A', age: 1}}, {user: {name: 'B', age: 2}}]);
    const Row = z.object({
      user: z.object({
        name: z.string(),
        age: z.number()
      })
    });

    const res = validateArrowTableAgainstZod(table, Row);
    expectOk(res);
  });

  it('Binary/Uint8Array is rejected unless schema is z.any()/z.unknown()', () => {
    const table = arrow.tableFromJSON([
      {bytes: new Uint8Array([1, 2, 3])},
      {bytes: new Uint8Array([4, 5])}
    ]);

    const RowBad = z.object({bytes: z.string()}); // should not match Binary
    const bad = validateArrowTableAgainstZod(table, RowBad);
    expectNotOk(bad);
    hasIssue(bad, 'bytes', 'Type mismatch');

    const RowAny = z.object({bytes: z.any()});
    const goodAny = validateArrowTableAgainstZod(table, RowAny);
    expectOk(goodAny);

    const RowUnknown = z.object({bytes: z.unknown()});
    const goodUnknown = validateArrowTableAgainstZod(table, RowUnknown);
    expectOk(goodUnknown);
  });

  it('optional/nullable interplay does not error by default when Arrow is NOT NULL', () => {
    // Arrow columns produced by arrow.tableFromJSON are usually nullable,
    // but this test ensures our validator doesn't *complain* when Zod is looser.
    const table = arrow.tableFromJSON([{name: 'A'}]);
    const Row = z.object({
      name: z.string().optional().nullable()
    });
    const res = validateArrowTableAgainstZod(table, Row);
    expectOk(res);
  });

  // it("mismatch within nested/array types is reported", () => {
  //  TODO - inference of nested List<Struct> doesn't seem to work in Arrow JS 17
  //   const table = arrow.tableFromJSON([
  //     { users: [{ name: "A", age: 1 }] }
  //   ]);
  //   // Expect array of objects with `age` as string (mismatch)
  //   const Row = z.object({
  //     users: z.array(z.object({
  //       name: z.string(),
  //       age: z.string()
  //     }))
  //   });

  //   const res = validateArrowTableAgainstZod(table, Row);
  //   expectNotOk(res);
  // });
});
