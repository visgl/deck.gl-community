import * as arrow from 'apache-arrow';
import {
  ZodArray,
  ZodBigInt,
  ZodBoolean,
  ZodDate,
  ZodDefault,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodString,
  ZodTypeAny
} from 'zod';

/**
 * Options that tune schema validation behavior when comparing an
 * Apache Arrow {@link arrow.Table} to a Zod row schema (a `z.object({...})`).
 */
export type ArrowZodValidationOptions = {
  /**
   * Whether the Arrow table may contain **extra columns** not present in the Zod schema.
   *
   * When `true`, extra Arrow columns are ignored; when `false`, they’re
   * reported as issues. Defaults to `true`.
   *
   * Use `false` if you want a strictly controlled schema where the table
   * must not contain columns outside the Zod contract.
   */
  allowExtraColumns?: boolean;

  /**
   * Whether **missing optional Zod fields** are allowed.
   *
   * If a field is defined in the Zod schema as `optional()` (or `nullable().optional()`),
   * and the Arrow table lacks that column entirely, the validator will:
   * - **Allow** it when this flag is `true` (default),
   * - **Report** it as missing when this flag is `false`.
   *
   * Keep this `true` when optional fields may not always be materialized in data.
   */
  allowMissingOptionalFields?: boolean;

  /**
   * Whether to treat Arrow `Dictionary<T>` columns as equivalent to `T`
   * for type matching purposes.
   *
   * This is typically useful for categorical/string columns where Arrow
   * encodes `Utf8` values with `Dictionary<Utf8>` for compression.
   * Defaults to `true`.
   */
  acceptDictionaryWrapped?: boolean;

  /**
   * Controls how `z.number()` is matched to Arrow numeric types.
   *
   * - `'any'` (default): accept ints and floats
   * - `'float-only'`: accept only floating types
   * - `'int-only'`: accept only integer types
   *
   * Choose `'int-only'` when you expect integer semantics and want to reject
   * floating columns that could cause precision drift.
   */
  numberMode?: 'any' | 'float-only' | 'int-only';
};

/**
 * A single schema validation issue discovered during Arrow↔Zod comparison.
 */
export interface ArrowZodIssue {
  /**
   * Path to the offending field. For top-level columns, this is `[columnName]`.
   * For nested `Struct` fields, this becomes a dotted-like path, e.g. `['user', 'age']`.
   */
  path: string[];
  /**
   * Human-readable message describing the problem (e.g., type mismatch, missing column).
   */
  message: string;
  /**
   * Optional extra information, such as the Arrow/Zod type descriptions or hints.
   */
  details?: unknown;
}

/**
 * Result of validating an Arrow {@link arrow.Table} against a Zod row schema.
 */
export interface ArrowZodResult {
  /**
   * `true` if no issues were found, otherwise `false`.
   */
  ok: boolean;
  /**
   * List of all issues detected during schema comparison.
   */
  issues: ArrowZodIssue[];
}

/**
 * Validate that an Arrow {@link arrow.Table}’s **schema** is compatible with a **Zod row schema**.
 *
 * This function checks **column names**, **nested shapes** (Struct/List), and
 * **logical types** (e.g., `Utf8`, numeric, `Bool`, `Timestamp`, `Date*`, `Dictionary` wrapper).
 * It does **not** validate row values; it only inspects schemas.
 *
 * ### Zod↔Arrow Type Mapping (high level)
 * - `z.string()` ↔ `arrow.Utf8` (also `Dictionary<Utf8>` when `acceptDictionaryWrapped`)
 * - `z.number()` ↔ numerics according to {@link ArrowZodValidationOptions.numberMode}
 * - `z.bigint()` ↔ `arrow.Int64` or `arrow.Uint64`
 * - `z.boolean()` ↔ `arrow.Bool`
 * - `z.date()` ↔ `arrow.Timestamp` or `arrow.DateDay`/`arrow.DateMillisecond`
 * - `z.array(T)` ↔ `arrow.List<T>`
 * - `z.object({...})` ↔ `arrow.Struct`
 * - `z.any()` / `z.unknown()` accepts any Arrow type (useful for `arrow.Binary`)
 *
 * ### Nullability & Optionality
 * - Zod `optional()`/`nullable()` is interpreted at **schema level**, not per-value.
 * - By default, the validator is permissive about nullability differences if the
 *   Arrow field is NOT NULL but Zod allows null/undefined; you can add stricter
 *   checks if desired.
 *
 * ### Extras & Missing Columns
 * - Missing **optional** Zod fields can be allowed with
 *   {@link ArrowZodValidationOptions.allowMissingOptionalFields}.
 * - Extra Arrow columns can be rejected by setting
 *   {@link ArrowZodValidationOptions.allowExtraColumns} to `false`.
 *
 * ### Dictionary Encoding
 * - If {@link ArrowZodValidationOptions.acceptDictionaryWrapped} is `true` (default),
 *   `Dictionary<T>` columns are treated as `T`. This is especially common with strings.
 *
 * ### Examples
 * ```ts
 * import { z } from 'zod';
 * import { tableFromJSON } from 'apache-arrow';
 *
 * const table = tableFromJSON([
 *   { id: 1, name: 'Alice', active: true },
 *   { id: 2, name: 'Bob',   active: false }
 * ]);
 *
 * const Row = z.object({
 *   id: z.number(),
 *   name: z.string(),
 *   active: z.boolean()
 * });
 *
 * const res = validateArrowTableAgainstZod(table, Row, {
 *   allowExtraColumns: false,
 *   numberMode: 'any',
 *   acceptDictionaryWrapped: true
 * });
 *
 * if (!res.ok) console.error(res.issues);
 * ```
 *
 * @param table The Arrow table whose schema is to be validated.
 * @param rowSchema A Zod schema describing a **single row** (usually `z.object({...})`).
 * @param options Validation options controlling strictness and type matching; see {@link ArrowZodValidationOptions}.
 * @returns A {@link ArrowZodResult} containing the overall status and any issues.
 */
export function validateArrowTableAgainstZod(
  table: arrow.Table,
  rowSchema: ZodTypeAny,
  options: ArrowZodValidationOptions = {}
): ArrowZodResult {
  const {
    allowExtraColumns = true,
    allowMissingOptionalFields = true,
    acceptDictionaryWrapped = true,
    numberMode = 'any'
  } = options;

  const issues: ArrowZodIssue[] = [];

  const base = unwrapZod(rowSchema);
  if (!(base instanceof ZodObject)) {
    issues.push({
      path: [],
      message: 'Row schema must be a Zod object (z.object({...})).'
    });
    return {ok: false, issues};
  }

  // Ensure correct typing for the shape so entries yield ZodTypeAny values.
  const zShape = (base as ZodObject<Record<string, ZodTypeAny>>).shape;
  const arrowFields = table.schema.fields;
  const arrowByName = new Map<string, arrow.Field>();
  for (const f of arrowFields) arrowByName.set(f.name, f);

  // 1) Check every Zod field against Arrow
  for (const [name, zField] of Object.entries(zShape) as [string, ZodTypeAny][]) {
    const field = arrowByName.get(name);
    const zBase = unwrapZod(zField);

    const {optional} = getOptionality(zField);
    if (!field) {
      if (optional && allowMissingOptionalFields) {
        // ok to be missing
      } else {
        issues.push({
          path: [name],
          message: `Missing Arrow column for required Zod field '${name}'.`
        });
      }
      continue;
    }

    // Type compatibility check
    const ok = arrowMatchesZodType(field.type, zBase, {
      numberMode,
      acceptDictionaryWrapped
    });

    if (!ok) {
      issues.push({
        path: [name],
        message: `Type mismatch for '${name}'.`,
        details: {
          arrowType: describeArrowType(field.type),
          zodType: describeZodType(zBase),
          hint: 'Adjust schema or toggle options (numberMode / acceptDictionaryWrapped).'
        }
      });
    }
  }

  // 2) Extra Arrow columns?
  if (!allowExtraColumns) {
    for (const f of arrowFields) {
      if (!zShape[f.name]) {
        issues.push({
          path: [f.name],
          message: `Extra Arrow column '${f.name}' not present in Zod schema.`
        });
      }
    }
  }

  return {ok: issues.length === 0, issues};
}

/* ---------- Internals ---------- */

/**
 * Remove Zod wrappers until a core type is reached.
 *
 * Unwraps `z.default()`, `z.optional()`, `z.nullable()`, and `z.preprocess()/z.transform()` (effects wrapper),
 * returning the underlying base type (string/number/object/array/etc.).
 *
 * This is used for **schema-level** comparison only; it does not execute effects.
 *
 * @param t The Zod type to unwrap.
 * @returns The innermost non-wrapper Zod type.
 */
function unwrapZod<T extends ZodTypeAny>(t: T): ZodTypeAny {
  let cur: ZodTypeAny = t;
  let guard = 0;
  while (guard++ < 32) {
    if (cur instanceof ZodDefault) {
      cur = (cur as ZodDefault<any>)._def.innerType;
      continue;
    }
    if (cur instanceof ZodOptional) {
      cur = (cur as ZodOptional<any>)._def.innerType;
      continue;
    }
    if (cur instanceof ZodNullable) {
      cur = (cur as ZodNullable<any>)._def.innerType;
      continue;
    }
    if (isZodEffects(cur)) {
      const inner = innerZodSchema(cur);
      if (inner) {
        cur = inner;
        continue;
      }
    }
    break;
  }
  return cur;
}

/**
 * Inspect a Zod type and report whether it is `optional()` and/or `nullable()`,
 * ignoring any other wrappers like `default()` or `effects`.
 *
 * @param t The Zod type to analyze.
 * @returns An object with `optional` and `nullable` booleans.
 */
function getOptionality(t: ZodTypeAny): {optional: boolean; nullable: boolean} {
  let optional = false;
  let nullable = false;
  let cur: ZodTypeAny = t;
  let guard = 0;
  while (guard++ < 32) {
    if (cur instanceof ZodDefault) {
      cur = (cur as ZodDefault<any>)._def.innerType;
      continue;
    }
    if (cur instanceof ZodOptional) {
      optional = true;
      cur = (cur as ZodOptional<any>)._def.innerType;
      continue;
    }
    if (cur instanceof ZodNullable) {
      nullable = true;
      cur = (cur as ZodNullable<any>)._def.innerType;
      continue;
    }
    if (isZodEffects(cur)) {
      const inner = innerZodSchema(cur);
      if (inner) {
        cur = inner;
        continue;
      }
    }
    break;
  }
  return {optional, nullable};
}

/**
 * Determine whether an Arrow {@link arrow.DataType} is compatible with a Zod type,
 * subject to the provided configuration.
 *
 * ### Notable behaviors
 * - If `acceptDictionaryWrapped` is `true`, `Dictionary<T>` unwraps to `T`.
 * - `z.number()` mapping is controlled by `numberMode`.
 * - `z.any()` and `z.unknown()` accept any Arrow type (useful for `arrow.Binary`).
 * - `z.array(T)` requires `arrow.List<T>`, recursively checking the element types.
 * - `z.object({...})` requires `arrow.Struct` with compatible child names and types.
 *
 * @param arrowType Arrow logical type to test.
 * @param zType Zod type to test against.
 * @param cfg Configuration controlling number handling and dictionary acceptance.
 * @returns `true` if types are compatible, else `false`.
 */
function arrowMatchesZodType(
  arrowType: arrow.DataType,
  zType: ZodTypeAny,
  cfg: {numberMode: 'any' | 'float-only' | 'int-only'; acceptDictionaryWrapped: boolean}
): boolean {
  // Unwrap dictionary if allowed
  if (cfg.acceptDictionaryWrapped && arrowType instanceof arrow.Dictionary) {
    return arrowMatchesZodType(arrowType.valueType, zType, cfg);
  }

  // Primitive mappings
  if (zType instanceof ZodString) {
    return arrowType instanceof arrow.Utf8;
  }
  if (zType instanceof ZodBoolean) {
    return arrowType instanceof arrow.Bool;
  }
  if (zType instanceof ZodNumber) {
    switch (cfg.numberMode) {
      case 'float-only':
        return (
          arrowType instanceof arrow.Float16 ||
          arrowType instanceof arrow.Float32 ||
          arrowType instanceof arrow.Float64
        );
      case 'int-only':
        return (
          arrowType instanceof arrow.Int8 ||
          arrowType instanceof arrow.Int16 ||
          arrowType instanceof arrow.Int32 ||
          arrowType instanceof arrow.Int64 ||
          arrowType instanceof arrow.Uint8 ||
          arrowType instanceof arrow.Uint16 ||
          arrowType instanceof arrow.Uint32 ||
          arrowType instanceof arrow.Uint64
        );
      case 'any':
      default:
        return (
          arrowType instanceof arrow.Float16 ||
          arrowType instanceof arrow.Float32 ||
          arrowType instanceof arrow.Float64 ||
          arrowType instanceof arrow.Int8 ||
          arrowType instanceof arrow.Int16 ||
          arrowType instanceof arrow.Int32 ||
          arrowType instanceof arrow.Int64 ||
          arrowType instanceof arrow.Uint8 ||
          arrowType instanceof arrow.Uint16 ||
          arrowType instanceof arrow.Uint32 ||
          arrowType instanceof arrow.Uint64
        );
    }
  }
  if (zType instanceof ZodBigInt) {
    // Expect 64-bit integral types
    return arrowType instanceof arrow.Int64 || arrowType instanceof arrow.Uint64;
  }
  if (zType instanceof ZodDate) {
    // Accept Timestamp or Date logical types
    return (
      arrowType instanceof arrow.Timestamp ||
      arrowType instanceof arrow.DateDay ||
      arrowType instanceof arrow.DateMillisecond
    );
  }

  // Binary / bytes acceptance via z.any()/z.unknown()
  const zodTypeTag = getZodDefType(zType);
  if (zodTypeTag === 'any' || zodTypeTag === 'unknown') {
    return true;
  }

  // Array <-> List
  if (zType instanceof ZodArray) {
    if (!(arrowType instanceof arrow.List)) return false;
    const elemZ = unwrapZod((zType as any)?._def?.element as ZodTypeAny);
    return arrowMatchesZodType(arrowType.valueType, elemZ, cfg);
  }

  // Object <-> Struct
  if (zType instanceof ZodObject) {
    if (!(arrowType instanceof arrow.Struct)) return false;

    const zShape = (zType as ZodObject<Record<string, ZodTypeAny>>).shape;
    const arrowChildren = (arrowType as arrow.Struct).children ?? (arrowType as any).fields;
    const byName = new Map<string, arrow.DataType>();
    for (const f of arrowChildren) byName.set(f.name, f.type);

    for (const [k, zChild] of Object.entries(zShape) as [string, ZodTypeAny][]) {
      const childType = byName.get(k);
      if (!childType) return false;
      if (!arrowMatchesZodType(childType, unwrapZod(zChild), cfg)) return false;
    }
    return true;
  }

  // Fallbacks for common miscellaneous mappings
  if (arrowType instanceof arrow.Binary) {
    // No native Zod 'bytes' type at schema level; accept via any/unknown.
    return false;
  }

  return false;
}

/**
 * Render a human-friendly description of an Arrow {@link arrow.DataType}
 * for diagnostics/debug messages.
 *
 * Examples:
 * - `Utf8`
 * - `Dictionary<Utf8>`
 * - `Timestamp(microsecond, tz=UTC)`
 *
 * @param t Arrow data type to describe.
 * @returns A short string describing the type.
 */
function describeArrowType(t: arrow.DataType): string {
  if (t instanceof arrow.Dictionary) return `Dictionary<${describeArrowType(t.valueType)}>`;
  const ctor = (t as any)?.constructor?.name ?? 'DataType';
  if (t instanceof arrow.Timestamp) {
    return `Timestamp(${t.unit}, tz=${(t as arrow.Timestamp).timezone ?? 'none'})`;
  }
  return ctor;
}

/**
 * Render a human-friendly description of a Zod type for diagnostics/debug messages.
 *
 * Attempts to use the Zod definition name if present (e.g., `'ZodString'`, `'ZodObject'`).
 *
 * @param zType Zod type to describe.
 * @returns A short string describing the Zod type.
 */
function describeZodType(zType: ZodTypeAny): string {
  const base = unwrapZod(zType);
  return getZodDefType(base) ?? base.constructor?.name ?? 'ZodType';
}

/**
 * Effect wrappers (preprocess/transform/refine) are represented by an internal
 * type whose class is not exported in Zod v4; rely on def.type instead.
 */
function isZodEffects(t: ZodTypeAny): boolean {
  const typeName = getZodDefType(t);
  if (!typeName) return false;
  return (
    typeName === 'transform' ||
    typeName === 'pipe' ||
    typeName === 'prefault' ||
    typeName === 'catch' ||
    typeName === 'success' ||
    typeName === 'readonly' ||
    typeName === 'nonoptional'
  );
}

function getZodDefType(t: ZodTypeAny): string | undefined {
  const type = (t as any)?._def?.type;
  return typeof type === 'string' ? type : undefined;
}

function innerZodSchema(t: ZodTypeAny): ZodTypeAny | undefined {
  const def = (t as any)?._def;
  if (!def) return undefined;

  // Common wrappers carry innerType/schema.
  if (def.innerType) return def.innerType as ZodTypeAny;
  if (def.schema) return def.schema as ZodTypeAny;

  // Pipelines hold in/out; prefer the output unless it's a bare transform.
  if (def.type === 'pipe') {
    const out = def.out as ZodTypeAny | undefined;
    const outTag = out && getZodDefType(out);
    if (out && outTag !== 'transform') return out;
    const inn = def.in as ZodTypeAny | undefined;
    if (inn) return inn;
    if (out) return out;
  }

  return undefined;
}
