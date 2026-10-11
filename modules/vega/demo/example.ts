import {parse, type Spec} from 'vega';
import {ViewGl} from '../src/index';

/** Each rectangle represents one record; layout changes preserve its identity. */
export function createExample(host: HTMLElement): {
  view: InstanceType<typeof ViewGl>;
  finalize: () => void;
} {
  const records = Array.from({length: 180}, (_, id) => ({
    id,
    group: id % 3,
    rank: Math.floor(id / 3),
    x: (id * 137) % 450,
    y: (id * 83) % 270
  }));
  const spec: Spec = {
    width: 500,
    height: 320,
    padding: 20,
    signals: [
      {name: 'layout', value: 'grid'},
      {name: 'is3d', value: false}
    ],
    data: [{name: 'table', values: records}],
    scales: [
      {name: 'color', type: 'ordinal', domain: [0, 1, 2], range: ['#3688c8', '#e69f00', '#009e73']}
    ],
    marks: [
      {
        type: 'rect',
        from: {data: 'table'},
        encode: {
          update: {
            x: {
              signal:
                "layout === 'grid' ? (datum.id % 18) * 26 : layout === 'scatter' ? datum.x : datum.group * 155 + (datum.rank % 6) * 20"
            },
            y: {
              signal:
                "layout === 'grid' ? floor(datum.id / 18) * 26 : layout === 'scatter' ? datum.y : 290 - floor(datum.rank / 6) * 24"
            },
            width: {signal: "layout === 'scatter' ? 9 : 18"},
            height: {signal: "layout === 'scatter' ? 9 : 18"},
            fill: {scale: 'color', field: 'group'}
          }
        }
      }
    ]
  };
  Object.assign(spec.marks[0].encode.update, {depth: {signal: 'is3d ? 12 : 0'}});
  host.innerHTML = `<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px">
    <label>Layout <select aria-label="Layout"><option value="grid">Grid</option><option value="scatter">Scatter</option><option value="stacks">Grouped stacks</option></select></label>
    <label><input type="checkbox" aria-label="3D view"> 3D view</label>
    <span>180 records · one cube per record</span>
    </div><div data-chart style="height:420px;position:relative"></div>`;
  let is3d = false;
  const view = new ViewGl(parse(spec), {
    getView: () => (is3d ? '3d' : '2d'),
    presenterConfig: {
      onSceneRectAssignCubeOrdinal: (datum: {id: number}) => datum.id,
      transitionDurations: {position: 1200, size: 1200, color: 600, view: 1200}
    }
  });
  const reportError = (error: unknown) => {
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = String(error);
    host.appendChild(message);
  };
  view.renderer('deck.gl').initialize(host.querySelector<HTMLElement>('[data-chart]'));
  view.runAsync().catch(reportError);
  host.querySelector('select').addEventListener('change', event => {
    view
      .signal('layout', (event.target as HTMLSelectElement).value)
      .runAsync()
      .catch(reportError);
  });
  host.querySelector('input').addEventListener('change', event => {
    is3d = (event.target as HTMLInputElement).checked;
    view.signal('is3d', is3d).runAsync().catch(reportError);
  });
  return {
    view,
    finalize: () => {
      view.finalize();
      host.replaceChildren();
    }
  };
}
