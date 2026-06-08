import PanelLiveExample from '@site/src/components/docs/panel-live-example';

# PanelComponent

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.4-green.svg?style=flat-square" alt="from v9.4" />
</p>

<PanelLiveExample highlight="panels" />

`PanelComponent` is the root mountable UI class owned by
`@deck.gl-community/panels`.

Extend it for panel-managed UI that is not itself a panel container, such as a
toolbar, toast stack, or application-specific standalone control.

## Usage

```ts
import {PanelComponent, type PanelComponentProps} from '@deck.gl-community/panels';

class StatusComponent extends PanelComponent<PanelComponentProps> {
  placement = 'top-right' as const;
  className = 'status-component';

  override onRenderHTML(rootElement: HTMLElement): void {
    rootElement.textContent = 'Ready';
  }
}
```

## Props

```ts
type PanelComponentProps = {
  id?: string;
  style?: Partial<CSSStyleDeclaration>;
  className?: string;
  _container?: string | HTMLElement | null;
};
```

## Lifecycle

`PanelComponent` owns the shared host lifecycle used by `PanelManager` and
`PanelWidget`: mounting, root element creation, prop updates, HTML rendering,
removal, placement, and optional deck redraw, viewport, hover, and pointer
hooks.

## Remarks

- `Panel`, `PanelContainer`, `ToolbarComponent`, and `ToastComponent` extend
  `PanelComponent`.
- Use `PanelManager` to mount components without deck.gl.
- Use `PanelWidget` from `@deck.gl-community/widgets` to adapt one component to
  deck.gl's `widgets` prop.
