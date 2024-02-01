import test from 'tape-catch';
import {add} from '@deck.gl-community/template';

test('add', (t) => {
  t.is(add(1, 2), 3);
  t.end();
});
