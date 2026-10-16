# TreeLayer

One small garden shows all eight species using `getTree` traits, seasons, crown
shape, explicit attached/fallen crops, GPU wind and owner picking. Drag to orbit,
scroll to zoom, and hover over a tree to identify its species.

Run `yarn workspace @deck.gl-community/tree-lab-example start` from the repository root.
The website also provides WebGL2/WebGPU device tabs. Wood/crop shadows use the
standard WebGL `LightingEffect`; optical foliage shadows require separate host composition.
