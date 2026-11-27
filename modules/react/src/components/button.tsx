// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ComponentPropsWithoutRef} from 'react';

const buttonStyle = {
  display: 'block',
  color: '#fff',
  backgroundColor: 'rgb(90, 98, 94)',
  fontSize: '1em',
  margin: '0.25em',
  padding: '0.375em 0.75em',
  border: '1px solid transparent',
  borderRadius: '0.25em'
};

export function Button(props: ComponentPropsWithoutRef<'button'>) {
  const {style, ...rest} = props;
  return <button {...rest} style={{...buttonStyle, ...style}} />;
}
