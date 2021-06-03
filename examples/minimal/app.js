import React from 'react';
import {add} from '@visgl-project-template/submodule';

export default function App() {
  const a = 1;
  const b = 2;
  return (
    <div>{a} + {b} = {add(a, b)}</div>
  );
}
