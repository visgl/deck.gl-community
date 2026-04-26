// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

type PropOption<Value extends string = string> = {value: Value; label: string};

type BasePropDescription<_TValues> = {
  title: string;
  description?: string;
  fullWidth?: boolean;
};

export type NumberPropDescription<TValues> = BasePropDescription<TValues> & {
  type: 'number';
  step?: number;
  min?: number | ((values: TValues) => number);
  max?: number | ((values: TValues) => number);
};

export type SelectPropDescription<
  TValues,
  Value extends string = string
> = BasePropDescription<TValues> & {
  type: 'select';
  options: readonly PropOption<Value>[];
};

export type BooleanPropDescription<TValues> = BasePropDescription<TValues> & {
  type: 'boolean';
};

export type PropDescription<TValues> =
  | NumberPropDescription<TValues>
  | SelectPropDescription<TValues>
  | BooleanPropDescription<TValues>;

export type PropDescriptions<TValues> = Record<string, PropDescription<TValues>>;

export type PropValues<TDescriptions extends PropDescriptions<any>> = {
  [K in keyof TDescriptions]: TDescriptions[K] extends NumberPropDescription<any>
    ? number
    : TDescriptions[K] extends SelectPropDescription<any, infer Value>
      ? Value
      : TDescriptions[K] extends BooleanPropDescription<any>
        ? boolean
        : never;
};
