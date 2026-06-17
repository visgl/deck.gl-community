# `modules/panels` guidance

This file applies to the `modules/panels` package.

## Package boundaries

- `@deck.gl-community/panels` must remain deck.gl-independent.
- Do not add imports from any `@deck.gl/*` package in this module.
- Do not add imports from any other `@deck.gl-community/*` package in this module.
- If deck.gl integration is needed, implement it in `modules/widgets` as a wrapper around `panels` exports.

## API direction

- Prefer panel-oriented names over widget-oriented names in this package.
- Do not expose framework implementation details such as raw Preact components as the primary public API when a class or data model API is sufficient.
