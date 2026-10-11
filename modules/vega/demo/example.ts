import unitLayouts from '../../../examples/vega/specs/unit-layouts.json';
import {createVegaView} from '../../../examples/vega/create-vega-view';
import type {Spec} from 'vega';

/** Shared JSON defines the records, layouts and native Vega signal controls. */
export function createExample(host: HTMLElement) {
  host.style.height = '468px';
  const {view, ready, finalize} = createVegaView(host, unitLayouts as unknown as Spec);
  ready.catch(error => {
    const message = host.ownerDocument.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = String(error);
    host.append(message);
  });
  return {
    view,
    finalize: () => {
      finalize();
      host.replaceChildren();
    }
  };
}
