# Overview

`@deck.gl-community/panels` contains the deck-independent panel system that used to
live inside `@deck.gl-community/widgets`.

Use this package when you want reusable panel composition, `WidgetHost`, or
standalone UI such as `ToolbarWidget` and `ToastWidget` without depending on
deck.gl's `Widget` runtime.

For deck-facing wrappers such as `BoxWidget`, `ModalWidget`, `SidebarWidget`, and
`FullScreenPanelWidget`, use `@deck.gl-community/widgets`.

:::danger
The deck.gl-community repo is specifically set up to collect useful code that no longer has dedicated maintainers. This means that there is often no one who can respond quickly to issues. The vis.gl / Open Visualization team members who try to keep this running can only put a few hours into it every now and then. It is important to understand this limitation. If your project depends on timely fixes, and you are not able to contribute them yourself, deck.gl-community modules may not be the right choice for you.
:::
