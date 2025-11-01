# Upgrade Guide

Modules in `@deck.gl-community` are independently maintained, so this page will only list occasional major changes.

Please refer the documentation of each module for detailed upgrade guides.

## GraphLayer

- Use the `data` prop to supply raw graph data, `Graph`, or `GraphEngine` instances. The `graph` prop is deprecated and will be
  removed in a future release.
