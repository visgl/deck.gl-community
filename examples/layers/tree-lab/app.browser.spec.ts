// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it} from 'vitest';
import {
  COORDINATE_SYSTEM,
  MapController,
  MapView,
  type Deck,
  type PickingInfo
} from '@deck.gl/core';
import {SplatLayer, type TreeLayer, type TreeSpec, type TreeType} from '@deck.gl-community/layers';
import {mountTreeLabExample} from './app';

const SPECIES: TreeType[] = [
  'pine',
  'oak',
  'palm',
  'birch',
  'cherry',
  'banyan',
  'mangrove',
  'citrus'
];

it('renders an authored 10,000-tree core with a continuous, pickable forest apron', async () => {
  const parent = document.createElement('div');
  // Match the 1080p recording lane: automatic refinement is intentionally measured at the
  // actual hero delivery size, not a small unit-test canvas.
  Object.assign(parent.style, {width: '1920px', height: '1080px'});
  document.body.append(parent);
  let deck!: Deck<MapView>;
  const errors: string[] = [];
  const cleanup = mountTreeLabExample(parent, {
    onDeckInitialized(instance) {
      deck = instance;
      deck.setProps({onError: error => errors.push(error.message)});
    }
  });
  const trees = () => deck.props.layers[1] as TreeLayer<TreeSpec>;
  const change = (name: string, value: string) => {
    const element = parent.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
    element.value = value;
    element.dispatchEvent(new Event('input', {bubbles: true}));
  };
  try {
    const data = trees().props.data as TreeSpec[];
    const core = data.slice(0, 10_000);
    const backdrop = data.slice(10_000);
    expect(data).toHaveLength(16_600);
    expect(core).toHaveLength(10_000);
    expect(backdrop).toHaveLength(6_600);
    const counts = core.reduce(
      (result, tree) => {
        result[tree.species!]++;
        return result;
      },
      Object.fromEntries(SPECIES.map(species => [species, 0])) as Record<TreeType, number>
    );
    expect(counts).toEqual(Object.fromEntries(SPECIES.map(species => [species, 1250])));
    expect(data.every(tree => tree.wind === false)).toBe(true);
    expect(backdrop.every(tree => tree.crop === undefined)).toBe(true);
    const backdropExtents = backdrop.map(tree => {
      const [x, y] = tree.position as [number, number, number];
      return Math.max(Math.abs(x), Math.abs(y));
    });
    // The fixed 6,600-owner continuation field has four overlapping, warped rounded-square
    // ranges. The two apron ranges bridge the authored edge without making a dark collar, then
    // the taper and horizon keep trees visible beyond it in every direction.
    const innerApron = backdrop.slice(0, 2_800);
    const outerApron = backdrop.slice(2_800, 4_800);
    const apron = backdrop.slice(0, 4_800);
    const taper = backdrop.slice(4_800, 6_000);
    const horizon = backdrop.slice(6_000);
    const tail = backdrop.slice(4_800);
    const coreTreeHalfExtent = 420.75;
    const roundedSquareDistance = (tree: TreeSpec) => {
      const [x, y] = tree.position as [number, number, number];
      const qx = Math.abs(x) - coreTreeHalfExtent;
      const qy = Math.abs(y) - coreTreeHalfExtent;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    };
    expect(innerApron).toHaveLength(2_800);
    expect(outerApron).toHaveLength(2_000);
    expect(taper).toHaveLength(1_200);
    expect(horizon).toHaveLength(600);
    expect(
      innerApron.every(distance => {
        const value = roundedSquareDistance(distance);
        return value >= -95 && value <= 220;
      })
    ).toBe(true);
    expect(
      outerApron.every(tree => {
        const value = roundedSquareDistance(tree);
        return value >= 20 && value <= 690;
      })
    ).toBe(true);
    expect(
      taper.every(tree => {
        const value = roundedSquareDistance(tree);
        return value >= 460 && value <= 1_840;
      })
    ).toBe(true);
    expect(
      horizon.every(tree => {
        const value = roundedSquareDistance(tree);
        return value >= 1_460 && value <= 3_540;
      })
    ).toBe(true);
    const seamSides = [
      apron.filter(tree => {
        const [x, y] = tree.position as [number, number, number];
        return x >= coreTreeHalfExtent - 55 && x <= coreTreeHalfExtent + 115 && Math.abs(y) < 381;
      }),
      apron.filter(tree => {
        const [x, y] = tree.position as [number, number, number];
        return x <= -coreTreeHalfExtent + 55 && x >= -coreTreeHalfExtent - 115 && Math.abs(y) < 381;
      }),
      apron.filter(tree => {
        const [x, y] = tree.position as [number, number, number];
        return y >= coreTreeHalfExtent - 55 && y <= coreTreeHalfExtent + 115 && Math.abs(x) < 381;
      }),
      apron.filter(tree => {
        const [x, y] = tree.position as [number, number, number];
        return y <= -coreTreeHalfExtent + 55 && y >= -coreTreeHalfExtent - 115 && Math.abs(x) < 381;
      })
    ];
    expect(seamSides.every(side => side.length >= 250)).toBe(true);
    expect(
      seamSides.every(
        side =>
          side.filter(tree => {
            const [x, y] = tree.position as [number, number, number];
            return Math.max(Math.abs(x), Math.abs(y)) < coreTreeHalfExtent - 5;
          }).length >= 50
      )
    ).toBe(true);
    expect(tail).toHaveLength(1_800);
    const farTail = tail.filter(tree => {
      const [x, y] = tree.position as [number, number, number];
      return Math.hypot(x, y) > 1_300;
    });
    expect(
      Math.max(...farTail.map(tree => Math.hypot(...(tree.position as [number, number]))))
    ).toBeGreaterThan(3_000);
    expect(Math.max(...backdropExtents)).toBeLessThan(4_100);
    const horizonSectors = Array.from({length: 8}, () => 0);
    for (const tree of farTail) {
      const [x, y] = tree.position as [number, number, number];
      const sector = Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * 8) % 8;
      horizonSectors[sector]!++;
    }
    expect(horizonSectors.every(count => count >= 20)).toBe(true);
    expect(Math.max(...backdropExtents)).toBeGreaterThan(3_000);
    expect(Math.max(...backdropExtents)).toBeLessThanOrEqual(4_200);
    const heroTree = core[5050]!;
    expect(heroTree).toMatchObject({species: 'citrus', wind: false});
    expect(heroTree.height).toBeCloseTo(7, 4);
    expect(heroTree.crownRadius).toBeCloseTo(3.125, 4);
    expect(heroTree.characteristics).toMatchObject({
      seed: 73,
      branchDensity: 1.12,
      leafDensity: 1.16
    });
    expect(core.filter(tree => tree.crop !== undefined)).toEqual([heroTree]);
    expect(heroTree.crop).toMatchObject({kind: 'fruit', count: 88, radius: 0.085});
    // The data uses two shared morphology keys, with continuous deterministic dimensions. This
    // preserves TreeLayer's template grouping while avoiding a repeated specimen silhouette.
    expect(new Set(core.map(tree => JSON.stringify(tree.characteristics))).size).toBe(2);
    expect(new Set(core.map(tree => tree.height)).size).toBeGreaterThan(9000);
    for (const species of ['palm', 'mangrove'] as const) {
      const quadrants = [0, 0, 0, 0];
      for (const tree of core.filter(tree => tree.species === species)) {
        const [x, y] = tree.position as [number, number, number];
        quadrants[(x >= 0 ? 1 : 0) + (y >= 0 ? 2 : 0)]++;
      }
      expect(quadrants.every(count => count > 150)).toBe(true);
    }
    // The hero stays wrapped in broadleaf/citrus context, but tall palms and tangled mangroves
    // cannot sweep across its close-orbit foreground.
    expect(
      core.filter((tree, index) => {
        const column = index % 100;
        const row = Math.floor(index / 100);
        return (
          (tree.species === 'palm' || tree.species === 'mangrove') &&
          Math.hypot(column - 50, row - 50) < 8
        );
      })
    ).toEqual([]);
    const heroPosition = heroTree.position as [number, number, number];
    const nearestTallHabitatTree = Math.min(
      ...core
        .filter(tree => tree.species === 'palm' || tree.species === 'mangrove')
        .map(tree => {
          const position = tree.position as [number, number, number];
          return Math.hypot(position[0] - heroPosition[0], position[1] - heroPosition[1]);
        })
    );
    // The physical placement field may warp cells, but it cannot pull a tall foreground
    // canopy into the reserved close-orbit corridor around the fruiting citrus.
    expect(nearestTallHabitatTree).toBeGreaterThan(45);
    for (const species of ['oak', 'cherry', 'citrus'] as const) {
      const clusteredInterior = core.filter((tree, index) => {
        if (tree.species !== species) return false;
        const column = index % 100;
        const row = Math.floor(index / 100);
        return Math.min(column, row, 99 - column, 99 - row) >= 7;
      });
      expect(clusteredInterior.length).toBeGreaterThan(900);
    }
    expect(trees().props.maxCanopySplats).toBe('auto');
    expect(trees().props.foveationStrength).toBe(1);
    expect(trees().props.pickable).toBe(true);
    expect(deck.props.effects ?? []).toHaveLength(0);
    expect(deck.props.views).toBeInstanceOf(MapView);
    expect((deck.props.views as MapView).props.nearZMultiplier).toBe(0.02);
    expect((deck.props.views as MapView).props.altitude).toBe(3);
    expect(deck.props.controller).toMatchObject({
      type: MapController,
      dragMode: 'pan',
      dragPan: true,
      dragRotate: true,
      inertia: 150,
      scrollZoom: {speed: 0.02, smooth: false},
      doubleClickZoom: true,
      zoomAround: 'pointer',
      touchRotate: true
    });
    const layers = deck.props.layers as unknown as {
      props: {coordinateSystem?: number; coordinateOrigin?: number[]; shadowEnabled?: boolean};
    }[];
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.props.coordinateSystem).toBe(COORDINATE_SYSTEM.METER_OFFSETS);
      expect(layer.props.coordinateOrigin).toEqual([0, 0, 0]);
    }
    expect(layers[0]!.props.shadowEnabled).toBe(false);
    expect(parent.querySelector('[name="species"]')).toBeNull();
    expect(parent.querySelector('[name="shadows"]')).toBeNull();

    // The demo does not pass an authored detail/LOD setting to TreeLayer. At the deliberately
    // close hero framing, SplatLayer's normal screen-error allocator must independently promote
    // the focused citrus to hierarchy level zero (the finest terminal source).
    const canopies = () =>
      trees()
        .getSubLayers()
        .filter((layer): layer is SplatLayer<{object: TreeSpec}> => layer instanceof SplatLayer);
    const heroCanopy = () =>
      canopies().find(canopy =>
        canopy.state.owners.some(owner => owner.row.object.object === heroTree)
      );
    const heroRefinement = () => {
      const canopy = heroCanopy();
      const owner = canopy?.state.owners.find(owner => owner.row.object.object === heroTree);
      return owner ? canopy?.state.refinement.entries.get(owner.key) : undefined;
    };
    await expect.poll(() => heroRefinement()?.dominant, {timeout: 30_000}).toBe(0);
    const inspectionDetail: {inspection?: unknown} = {};
    parent
      .querySelector<HTMLDivElement>('.trees-demo')!
      .dispatchEvent(new CustomEvent('tree-lab:inspect-hero-splat', {detail: inspectionDetail}));
    expect(inspectionDetail.inspection).toMatchObject({
      hero: {index: 5050, species: 'citrus'},
      automatic: true,
      dominant: 0
    });

    change('season', 'autumn');
    change('crown-profile', 'lush');
    change('crown-spread', '1.15');
    change('leaf-density', '1.25');
    const getTree = trees().props.getTree as (tree: TreeSpec) => TreeSpec;
    const firstProfile = core[0]!.characteristics!;
    const renderedFirstTree = getTree(core[0]!);
    expect(renderedFirstTree).toMatchObject({
      species: 'pine',
      season: 'autumn',
      wind: false,
      characteristics: {
        seed: firstProfile.seed,
        crownSpread: Math.round(firstProfile.crownSpread! * 1.15 * 100) / 100,
        crownDepth: Math.round(firstProfile.crownDepth! * 1.08 * 100) / 100,
        crownAsymmetry: Math.round(firstProfile.crownAsymmetry! * 1.18 * 100) / 100,
        branchDensity: Math.round(firstProfile.branchDensity! * 1.18 * 100) / 100,
        leafDensity: Math.round(firstProfile.leafDensity! * 1.25 * 100) / 100
      }
    });
    expect(parent.querySelector<HTMLElement>('.trees-demo')!.dataset.season).toBe('autumn');

    const hero = parent.querySelector<HTMLButtonElement>('[data-camera-preset="hero"]')!;
    const overview = parent.querySelector<HTMLButtonElement>('[data-camera-preset="overview"]')!;
    const heroZoom = deck.props.initialViewState?.zoom as number;
    expect(hero.textContent).toBe('Hero citrus');
    expect(hero.getAttribute('aria-pressed')).toBe('true');
    overview.click();
    const overviewZoom = deck.props.initialViewState?.zoom as number;
    expect(overview.getAttribute('aria-pressed')).toBe('true');
    expect(heroZoom).toBeGreaterThan(overviewZoom + 3);
    hero.click();
    expect(hero.getAttribute('aria-pressed')).toBe('true');
    expect(deck.props.initialViewState?.maxZoom).toBeCloseTo(heroZoom + 4.5, 4);

    const tour = parent.querySelector<HTMLButtonElement>('[name="play-tour"]')!;
    expect(tour.dataset.tourEdition).toBe('landscape');
    expect(tour.dataset.tourDurationMs).toBe('10800');
    expect(tour.dataset.tourOrbitMs).toBe('2400');
    expect(tour.dataset.tourCanopyPullbackMs).toBe('6600');
    expect(tour.dataset.tourHighPitchPullbackMs).toBe('5200');
    expect(tour.dataset.tourCanopyPitchSettleMs).toBe('1400');
    expect(tour.dataset.tourCanopyDriftMs).toBe('0');
    expect(tour.dataset.tourFinalLiftMs).toBe('1800');
    const seekTour = (elapsedMs: number) => {
      parent
        .querySelector<HTMLDivElement>('.trees-demo')!
        .dispatchEvent(new CustomEvent('tree-lab:seek-tour', {detail: {elapsedMs}}));
      return deck.props.initialViewState!;
    };
    const sampleTour = (elapsedMs: number) => {
      const view = seekTour(elapsedMs);
      return {bearing: view.bearing!, pitch: view.pitch!, zoom: view.zoom!};
    };
    const orbitEnd = seekTour(2400);
    const canopyPitchHeld = seekTour(2400 + 5200);
    const canopyPitchSettling = seekTour(2400 + 5200 + 700);
    const canopyPitchSettled = seekTour(2400 + 5200 + 1400);
    const canopyEnd = seekTour(2400 + 6600);
    const finalLiftMidpoint = seekTour(2400 + 6600 + 900);
    const finalTourView = seekTour(10800);
    // Bearing continues through every stage: a close high-horizon orbit, a long, detailed
    // horizon-led pullback, a flat canopy arrival, then a deliberately late overview lift.
    expect(orbitEnd.bearing).toBeCloseTo(132, 4);
    expect(orbitEnd.pitch).toBe(85);
    expect(orbitEnd.zoom).toBeCloseTo(heroZoom, 4);
    expect(orbitEnd.position?.[2]).toBeCloseTo(3.7, 4);
    expect(canopyPitchHeld.bearing).toBeGreaterThan(orbitEnd.bearing!);
    // This is a meaningful pullback, not merely the transition's first frame: the high-pitch
    // detail view remains in place after more than one zoom level of travel.
    expect(canopyPitchHeld.zoom).toBeLessThan(orbitEnd.zoom! - 1);
    expect(canopyPitchHeld.pitch).toBe(85);
    expect(canopyPitchSettling.zoom).toBeLessThan(canopyPitchHeld.zoom!);
    expect(canopyPitchSettling.pitch).toBeGreaterThan(12);
    expect(canopyPitchSettling.pitch).toBeLessThan(85);
    expect(canopyPitchSettled.pitch).toBeCloseTo(12, 4);
    expect(canopyEnd.bearing).toBeCloseTo(204, 4);
    expect(canopyEnd.pitch).toBeCloseTo(12, 4);
    expect(canopyEnd.zoom).toBeCloseTo(canopyPitchSettled.zoom!, 4);
    expect(finalLiftMidpoint.bearing).toBeGreaterThan(canopyEnd.bearing!);
    expect(finalLiftMidpoint.pitch).toBeGreaterThan(12);
    expect(finalLiftMidpoint.pitch).toBeLessThan(60);
    expect(finalTourView.bearing).toBeCloseTo(228, 4);
    expect(finalTourView.pitch).toBeCloseTo(60, 4);
    expect(finalTourView.zoom).toBeCloseTo(overviewZoom + 1.1, 4);

    // The camera carries physical angular velocity through every edit point. In particular, the
    // late lift must not drop the orbit to a standstill before beginning the final rise.
    const frameMs = 1000 / 60;
    const getBearingVelocity = (seamMs: number) => {
      const before = sampleTour(seamMs - frameMs).bearing;
      const at = sampleTour(seamMs).bearing;
      const after = sampleTour(seamMs + frameMs).bearing;
      return {incoming: (at - before) / frameMs, outgoing: (after - at) / frameMs};
    };
    for (const seamMs of [2400, 7600, 9000]) {
      const velocity = getBearingVelocity(seamMs);
      expect(Math.abs(velocity.incoming - velocity.outgoing)).toBeLessThan(0.002);
      expect(velocity.incoming).toBeGreaterThan(0);
      expect(velocity.outgoing).toBeGreaterThan(0);
    }
    let previous = sampleTour(0);
    for (let elapsedMs = 500; elapsedMs <= 10800; elapsedMs += 500) {
      const current = sampleTour(elapsedMs);
      expect(current.bearing).toBeGreaterThan(previous.bearing);
      expect(current.zoom).toBeLessThanOrEqual(previous.zoom + 0.000001);
      previous = current;
    }
    tour.click();
    expect(tour.getAttribute('aria-pressed')).toBe('true');
    parent.querySelector<HTMLDivElement>('.trees-stage')!.dispatchEvent(new Event('pointerdown'));
    expect(tour.getAttribute('aria-pressed')).toBe('false');

    await expect
      .poll(
        () =>
          deck
            .pickObjects({x: 0, y: 0, width: 1920, height: 1080})
            .some(info => data.includes(info.object as TreeSpec)),
        {timeout: 30_000}
      )
      .toBe(true);
    expect(deck.props.getTooltip?.({object: heroTree} as unknown as PickingInfo<TreeSpec>)).toBe(
      'citrus'
    );
    expect(errors).toEqual([]);
  } finally {
    cleanup();
    expect(parent.querySelector('canvas')).toBeNull();
    parent.remove();
  }
}, 60_000);

it('keeps the mixed forest stage reachable when its host is shorter than the controls', () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '320px', height: '180px'});
  document.body.append(parent);
  const cleanup = mountTreeLabExample(parent);
  const demo = parent.querySelector<HTMLDivElement>('.trees-demo')!;
  const stage = parent.querySelector<HTMLDivElement>('.trees-stage')!;
  try {
    expect(getComputedStyle(demo).overflowY).toBe('auto');
    expect(demo.scrollHeight).toBeGreaterThan(demo.clientHeight);
    expect(stage.getBoundingClientRect().bottom).toBeGreaterThan(
      demo.getBoundingClientRect().bottom
    );
    demo.scrollTop = demo.scrollHeight;
    expect(stage.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      demo.getBoundingClientRect().bottom
    );
  } finally {
    cleanup();
    parent.remove();
  }
});
