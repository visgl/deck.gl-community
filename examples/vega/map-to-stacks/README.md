# US map to stacked bars

Uses all 24,669 places in Microsoft Research SandDance’s historical `demovote.tsv` sample. The map, regional education bars and 3D geographic stacks share the same records and colors. Each tile is a place, not a population-weighted unit. Education percentages and place names are preserved from the sample; these are not current demographic estimates. The third view stacks places in projected geographic grid cells; stack height counts places, not population. Seven quantile bins run blue through neutral to warm as education increases; the legend shows the actual education ranges. Regions follow the contiguous-US Census grouping.

Data: [Microsoft SandDance demovote.tsv](https://github.com/microsoft/SandDance/blob/5f2c1e58467b9417bd626f0ef404bd3bda11f068/docs/sample-data/demovote.tsv), reduced to identifiers, coordinates, place, state and education. Microsoft’s MIT copyright and permission notice is retained in `LICENSE`.

Inspired by [SandDance](https://github.com/microsoft/SandDance), Microsoft Research, and the work of Dan Marshall, Steven Drucker and Roland Fernandez. The original [geographic scatterplot](https://microsoft.github.io/SandDance/tests/v4/umd/scatterplotTest.html) illustrates the dense unit-map appearance.
