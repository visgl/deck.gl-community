// deck.gl-community
// SPDX-License-Identifier: MIT
import type {Layer, View} from '@deck.gl/core';
import type {z} from 'zod';

/** A host-owned array of rows and an optional stable selection identity. */
export type PlaygroundDataBinding = {
  /** Row references are passed directly to layers without copying or expression conversion. */
  data: readonly unknown[];
  /** Maps a picked row to an identity that survives filtering and reordering. */
  getRowId?: (row: any, index: number) => string | number;
};

/** Named row arrays referenced by a layer's `data: {"@@data": "name"}` configuration. */
export type PlaygroundBindings = Record<string, PlaygroundDataBinding>;

/** Constructors and deferred values available to the built-in playground renderer. */
export type PlaygroundRegistry = {
  /** Layer constructors paired with schemas that include their `@@type` discriminator. */
  layers: Record<string, {type: new (props: any) => Layer; schema: z.ZodType}>;
  /** Additional view constructors; five deck.gl core views are always available. */
  views?: Record<string, {type: new (props: any) => View; schema: z.ZodType}>;
  /** Trusted host values addressed by `@@#name` or an own-property path. */
  constants?: Record<string, unknown>;
  /** Trusted factories invoked by `{"@@function": "name", ...options}`. */
  functions?: Record<string, (options: Record<string, unknown>) => unknown>;
};
