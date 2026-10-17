# TreeLayer

The showcase has two scenes. The default mixed-species forest renders one tree of each supported
species with seasonal, species-native crops: citrus fruit, pine cones, oak acorns, birch catkins,
cherry blossoms or fruit, and mangrove propagules. Crop load and size controls scale each species'
own crop profile; the crop shape is not selected independently of the tree. Individual fruits and
flowers vary deterministically beneath the species' configured maximum size.

Switch to the single-species grove to render up to 10,000 trees in fixed, slightly randomized rows.
The count slider adds or removes trees from a stable center-out layout, and natural variation
changes tree height and crown width while retaining shared geometry batches. The grove omits labels,
crops, and animated wind to keep the high-count view focused on TreeLayer rendering. Both scenes
expose height, crown spread and depth, branch density, leaf size, and season controls; the forest
also exposes wind and crop controls.

Run `yarn workspace @deck.gl-community/tree-lab-example start` from the repository root. The
standalone preview and website example share the same collapsible TreeLayer control panel. The
website example also provides WebGL2/WebGPU device tabs.
