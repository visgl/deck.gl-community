## Layout Animation

ow incremental layouts flow through the engine

Every layout implementation inherits from GraphLayout, which exposes lifecycle hooks (initializeGraph, start, update, resume, stop) that a concrete layout uses to perform iterative calculations. When a layout has progressed (e.g. one tick of a force simulation), it calls the protected _onLayoutChange() helper. That helper both bumps the layout’s version counter/state and emits an onLayoutChange event so observers can react to the new positions; similar helpers exist for onLayoutStart, onLayoutDone, and errors.

GraphEngine wires those layout lifecycle calls into the data model. When run() is invoked it subscribes to graph mutation events (node/edge add/remove and transaction boundaries) so it can mark the layout “dirty” and call updateGraph/update once a transaction finishes, ensuring the layout sees incremental topology changes as a batch. At the same time it listens to the layout’s own lifecycle events and simply re-dispatches them from the engine, acting as the single source consumers watch for animation progress. Because GraphLayout increments its version every time _onLayoutChange() runs, the engine’s getLayoutLastUpdate()/getLayoutState() accessors expose monotonically increasing values that can be used as change triggers for rendering layers.

Events the viewer must observe
The built-in GraphLayer demonstrates the expected wiring: after creating and run()ning a GraphEngine, it subscribes to the engine’s onLayoutChange event and calls forceUpdate() so deck.gl re-queries node/edge positions on every layout iteration. The layer also threads the engine’s layout version and state into each sub-layer’s positionUpdateTrigger, which ensures deck.gl’s diffing system invalidates attributes whenever the layout reports a new tick.

If you are orchestrating the engine yourself, you need to reproduce the same wiring: instantiate a GraphEngine, call run(), listen for its onLayoutChange (and optionally onLayoutStart/onLayoutDone) events, and on each notification trigger whatever re-render or animation step your application uses. Because the engine only fires those events when the underlying layout raises them, the visual stays in sync with incremental layout calculations.
