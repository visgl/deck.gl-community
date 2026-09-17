# deck.gl Community Playground

This is a standalone example of the installable `@deck.gl-community/playground` package. Every
template is a JSON deck document, and the preview includes built-in deck.gl layers plus selected
deck.gl-community layers. Accessors use the JSON playground convention, for example
`"getPosition": "@@=position"`.

```bash
yarn
yarn start
```

To run against the local workspace packages, use `yarn start-local` from the repository root after installing dependencies.

Included templates cover core deck.gl layers and community layers from `@deck.gl-community/geo-layers`,
`graph-layers`, `infovis-layers`, `layers`, and `timeline-layers`. The example registers those
constructors in its host application; production applications can provide their own registry and
rendering policy through `Playground`.
