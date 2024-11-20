// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React from 'react';
import {add} from '@deck.gl-community/template';

export default function App(): React.ReactElement {
  const a = 1;
  const b = 2;
  return (
    <div>
      {a} + {b} = {add(a, b)}
    </div>
  );
}
