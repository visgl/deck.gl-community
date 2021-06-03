import test from 'tape-catch';

import {add} from '@visgl-project-template/submodule';

test('add', t => {
  t.is(add(1, 2), 3);
  t.end();
});
