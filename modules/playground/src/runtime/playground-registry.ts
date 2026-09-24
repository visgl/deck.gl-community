// deck.gl-community
// SPDX-License-Identifier: MIT
import type {Layer, View} from '@deck.gl/core';
import type {z} from 'zod';

/** A layer constructor; built-in schemas are matched by its static layerName. */
export type PlaygroundLayerConstructor = (new (props: any) => Layer) & {layerName?: string};

/** A constructor with an explicit schema for custom props or a JSON type alias. */
export type PlaygroundLayerRegistration = {
  type: PlaygroundLayerConstructor;
  schema: z.ZodType;
};

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
  /** Only these layers are enabled. Known constructors use bundled schemas; custom layers supply one. */
  layers: Record<string, PlaygroundLayerConstructor | PlaygroundLayerRegistration>;
  /** Additional view constructors; five deck.gl core views are always available. */
  views?: Record<string, {type: new (props: any) => View; schema: z.ZodType}>;
  /** Trusted host values addressed by `@@#name`. */
  constants?: Record<string, unknown>;
  /** Named groups of host values addressed by `@@#group.member`. */
  enumerations?: Record<string, Record<string, unknown>>;
  /** Trusted factories invoked by `{"@@function": "name", ...options}`. */
  functions?: Record<string, (options: Record<string, unknown>) => unknown>;
};
