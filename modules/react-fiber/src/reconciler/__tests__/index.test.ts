import {describe, expect, expectTypeOf, it} from 'vitest';

import * as reconcilerModule from '../index';
import {catalogue} from '../extend';

describe('index', () => {
  it('should export createRoot', () => {
    expect(reconcilerModule).toHaveProperty('createRoot');
    expectTypeOf(reconcilerModule.createRoot).toBeFunction();
  });

  it('should export unmountAtNode', () => {
    expect(reconcilerModule).toHaveProperty('unmountAtNode');
    expectTypeOf(reconcilerModule.unmountAtNode).toBeFunction();
  });

  it('should export roots', () => {
    expect(reconcilerModule).toHaveProperty('roots');
    expect(reconcilerModule.roots).toBeInstanceOf(Map);
  });

  it('should export extend', () => {
    expect(reconcilerModule).toHaveProperty('extend');
    expectTypeOf(reconcilerModule.extend).toBeFunction();
  });

  it('should import side-effects automatically', () => {
    expect(reconcilerModule).toBeDefined();
    expect(catalogue.ScatterplotLayer).toBeDefined();
    expect(catalogue.MapView).toBeDefined();
  });
});
