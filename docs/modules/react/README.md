---
deckVersion: "10.0"
introduced: "9.0"
---

# Overview

| Import | Exports | Use |
| --- | --- | --- |
| `@deck.gl-community/react` | [`Panel`](./api-reference/panel.md#fiber-panel) | Mount a community panel as a deck.gl widget inside the upstream React Fiber `DeckGL` root. |
| `@deck.gl-community/react/legacy` | [`Panel`, `ReactPanel`, `useReactPanel`](./api-reference/panel.md#legacy-panel), `Modal`, `Button`, `Icon`, `LongPressButton` | Render panel content and UI controls in a React DOM tree, including MDX. |
| `@deck.gl-community/react/deck-canvas` | [`DeckCanvas`](./api-reference/deck-canvas.md) | Attach a canvas to an application-owned multi-canvas `Deck` instance. |

The Fiber root works with deck.gl v10's `@deck.gl/react` and its React 19.2+
requirements. The legacy components support React 18.3.1 and later React 18 releases, as well as React 19.
See [Get Started](./developer-guide/get-started.md) for examples.

:::caution
The deck.gl-community repository is semi-maintained. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::
