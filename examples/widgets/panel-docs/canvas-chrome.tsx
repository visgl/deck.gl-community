/** @jsxImportSource preact */
import {
  PanelManager,
  HeaderPanelContainer,
  FooterPanelContainer,
  SidePanelContainer,
  PinnablePanelContainer,
  CustomPanel,
  usePanelContainerState
} from '../../../modules/panels/src';
import {Panel} from '../../../modules/panels/src/panels/panel';

class InspectorPanel extends Panel {}

function InspectorContent() {
  const state = usePanelContainerState();
  return (
    <div style={{display: 'flex', flexDirection: state?.pinned ? 'column' : 'row', gap: '12px'}}>
      <p>{state?.pinned ? `Pinned ${state.side}` : 'Floating inspector'}</p>
      <label>
        Scene name <input defaultValue="My scene" style={{width: '120px'}} />
      </label>
    </div>
  );
}

/** Demonstrates application-owned host layout, chrome, and responsive subpanels. */
export function mountCanvasChromeExample(container: HTMLElement): () => void {
  const document = container.ownerDocument;
  const parent = document.createElement('div');
  Object.assign(parent.style, {
    width: '100%',
    height: '100%',
    position: 'relative',
    minHeight: '360px'
  });
  const content = document.createElement('div');
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, {display: 'block', width: '100%', height: '100%'});
  content.append(canvas);
  parent.append(content);
  container.append(parent);
  const manager = new PanelManager({parentElement: parent, contentElement: content});
  const textPanel = (id: string, text: string) =>
    new CustomPanel({
      id,
      title: text,
      onRenderHTML: element => {
        element.textContent = text;
      }
    });
  const inspector = new PinnablePanelContainer({
    title: 'Inspector',
    side: 'right',
    placement: 'top-right',
    widthPx: 280,
    panel: new InspectorPanel({
      id: 'inspector-content',
      title: 'Inspector',
      content: <InspectorContent />
    })
  });
  const controls = new CustomPanel({
    id: 'controls',
    title: 'Canvas chrome',
    onRenderHTML: element => {
      element.append(document.createTextNode('Canvas chrome · Dock inspector: '));
      const select = document.createElement('select');
      for (const side of ['left', 'right', 'top', 'bottom'] as const) {
        const option = document.createElement('option');
        option.value = side;
        option.textContent = side;
        option.selected = side === 'right';
        select.append(option);
      }
      select.setAttribute('aria-label', 'Inspector docking edge');
      select.onchange = () =>
        inspector.setProps({side: select.value as 'left' | 'right' | 'top' | 'bottom'});
      element.append(select);
    }
  });
  manager.setProps({
    components: [
      new HeaderPanelContainer({fitContent: true, panel: controls}),
      new FooterPanelContainer({
        fitContent: true,
        panel: textPanel(
          'status',
          'Drag the inspector divider to resize. Pin/unpin preserves the scene name.'
        )
      }),
      new SidePanelContainer({
        widthPx: 150,
        resizable: true,
        panel: textPanel('tools', 'Permanent tools')
      }),
      inspector
    ]
  });
  const draw = () => {
    const {width, height} = content.getBoundingClientRect();
    const ratio = document.defaultView?.devicePixelRatio ?? 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = '#183044';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#31556e';
    for (let x = 0; x < width; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y < height; y += 40) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.fillStyle = '#fff';
    context.font = '16px system-ui';
    context.fillText(`Canvas: ${Math.round(width)} × ${Math.round(height)}`, 20, height - 24);
  };
  const observer = new ResizeObserver(draw);
  observer.observe(content);
  draw();
  return () => {
    observer.disconnect();
    manager.finalize();
    parent.remove();
  };
}
