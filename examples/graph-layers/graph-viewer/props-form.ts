// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useId} from 'react';

type PropOption<Value extends string = string> = {value: Value; label: string};

type BasePropDescription<TValues> = {
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

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#0f172a'
};

const SELECT_STYLE: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  padding: '0.375rem 0.5rem',
  borderRadius: '0.375rem',
  border: '1px solid #cbd5f5',
  backgroundColor: '#ffffff',
  color: '#0f172a'
};

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: 'inherit',
  fontSize: '0.8125rem',
  padding: '0.375rem 0.5rem',
  borderRadius: '0.375rem',
  border: '1px solid #cbd5f5',
  color: '#0f172a',
  backgroundColor: '#ffffff'
};

const FIELD_GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: '0.75rem',
  rowGap: '0.5rem',
  alignItems: 'center'
};

const CHECKBOX_LABEL_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: '0.8125rem',
  color: '#334155'
};

type PropsFormProps<TDescriptions extends Record<string, PropDescription<any>>> = {
  descriptions: TDescriptions;
  values: PropValues<TDescriptions>;
  onChange?: <K extends keyof TDescriptions>(
    key: K,
    value: PropValues<TDescriptions>[K]
  ) => void;
};

export function PropsForm<TDescriptions extends Record<string, PropDescription<any>>>(
  {descriptions, values, onChange}: PropsFormProps<TDescriptions>
): React.ReactElement {
  const fieldGroupId = useId();
  const entries = Object.entries(descriptions) as [
    keyof TDescriptions,
    TDescriptions[keyof TDescriptions]
  ][];

  const children = entries.map(([key, description]) => {
    const fieldId = `${fieldGroupId}-${String(key)}`;
    const currentValue = values[key];

    if (description.type === 'number') {
      const min =
        typeof description.min === 'function'
          ? description.min(values)
          : description.min;
      const max =
        typeof description.max === 'function'
          ? description.max(values)
          : description.max;

      return React.createElement(
        React.Fragment,
        {key: String(key)},
        React.createElement(
          'label',
          {htmlFor: fieldId, style: LABEL_STYLE},
          description.title
        ),
        React.createElement('input', {
          id: fieldId,
          type: 'number',
          value: currentValue as number,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
            const numericValue = Number(event.target.value);
            if (!Number.isFinite(numericValue)) {
              return;
            }
            let nextValue = numericValue;
            if (typeof min === 'number') {
              nextValue = Math.max(min, nextValue);
            }
            if (typeof max === 'number') {
              nextValue = Math.min(max, nextValue);
            }
            onChange?.(key, nextValue as PropValues<TDescriptions>[typeof key]);
          },
          style: INPUT_STYLE,
          step: description.step,
          min,
          max
        })
      );
    }

    if (description.type === 'select') {
      return React.createElement(
        React.Fragment,
        {key: String(key)},
        React.createElement(
          'label',
          {htmlFor: fieldId, style: LABEL_STYLE},
          description.title
        ),
        React.createElement(
          'select',
          {
            id: fieldId,
            value: currentValue as string,
            onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
              onChange?.(
                key,
                event.target.value as PropValues<TDescriptions>[typeof key]
              ),
            style: SELECT_STYLE
          },
          description.options.map((option) =>
            React.createElement(
              'option',
              {key: option.value, value: option.value},
              option.label
            )
          )
        )
      );
    }

    return React.createElement(
      'label',
      {
        key: String(key),
        htmlFor: fieldId,
        style: {
          ...CHECKBOX_LABEL_STYLE,
          gridColumn: description.fullWidth ? '1 / -1' : undefined
        }
      },
      React.createElement('input', {
        id: fieldId,
        type: 'checkbox',
        checked: Boolean(currentValue),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onChange?.(
            key,
            event.target.checked as PropValues<TDescriptions>[typeof key]
          ),
        style: {width: '1rem', height: '1rem'}
      }),
      description.title
    );
  });

  return React.createElement('div', {style: FIELD_GRID_STYLE}, children);
}

export type {PropsFormProps};
