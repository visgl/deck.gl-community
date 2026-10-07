# Deprecated TreeLayer import

`@deck.gl-community/three` temporarily re-exports the canonical native `TreeLayer` from `@deck.gl-community/layers`. It contains no renderer or Three.js dependency. New code should import from `@deck.gl-community/layers`; the examples/migration PR removes this compatibility workspace.
