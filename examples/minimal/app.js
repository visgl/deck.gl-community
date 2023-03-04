import React from 'react';
import {add} from '@deck.gl-community/submodule';

export default function App() {
  const a = 1;
  const b = 2;
  return (
    <div>
      {a} + {b} = {add(a, b)}
    </div>
  );
}
