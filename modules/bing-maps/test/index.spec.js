import {loadModule} from '../src';

describe('exports', () => {
  it('contains public functions', () => {
    expect(loadModule).toBeTruthy();
  });
});
