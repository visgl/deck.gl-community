---
deckVersion: "10.0"
introduced: "9.0"
---

# Overview

| Import | Exports | Use |
| --- | --- | --- |
| `@deck.gl-community/react` | [`Panel`](./api-reference/panel.md#fiber-panel), [`DeckCanvas`](./api-reference/deck-canvas.md), [`DeviceTabs`](./developer-guide/get-started.md#graphics-backend-dropdown) | Mount a panel widget in React Fiber, attach a canvas to an application-owned `Deck`, or show the shared graphics backend dropdown. |
| `@deck.gl-community/react/legacy` | [`Panel`, `useReactPanel`](./api-reference/panel.md#legacy-panel) | Render panel content in a React DOM tree, including MDX. |

The package root uses `@deck.gl/react` and its React 19.2+ peers. Apps using
the classic DeckGL wrapper
can combine `@deck.gl/react/legacy` with the DOM panel components from
`@deck.gl-community/react/legacy`. The community DOM entry point supports
React 18.3.1 and later React 18 releases, as well as React 19.
See [Get Started](./developer-guide/get-started.md) for examples.

:::caution
The deck.gl-community repository is semi-maintained. One of its goals is to collect and preserve valuable deck.gl ecosystem related code that does not have a dedicated home. Some modules may no longer have dedicated maintainers. This means that there is sometimes no one who can respond quickly to issues.
:::
