import {afterEach, describe, expect, it, vi} from 'vitest';

import {imperativeDeckController} from '../../layers/index';
import {commandManager} from '@deck.gl-community/panels';
import {TRACEVIS_SHORTCUTS} from './tracevis-shortcuts';

describe('tracevis shortcuts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds an X shortcut that expands all processes', () => {
    const expandAllProcesses = vi.spyOn(imperativeDeckController, 'expandAllProcesses');

    const shortcut = TRACEVIS_SHORTCUTS.find(entry => entry.key === 'x' && !entry.shiftKey);

    expect(shortcut).toMatchObject({
      name: 'Expand All Processes',
      description: 'Expand all processes.',
      commandId: 'trace.expand-all-processes',
      displayPair: {
        id: 'tracevis-process-expansion',
        position: 'primary',
        description: 'Expand all with X / collapse all with Shift+X.'
      }
    });

    commandManager.executeCommand(shortcut!.commandId!);
    expect(expandAllProcesses).toHaveBeenCalledWith(true);
  });

  it('adds a Shift+X shortcut that collapses all processes', () => {
    const expandAllProcesses = vi.spyOn(imperativeDeckController, 'expandAllProcesses');

    const shortcut = TRACEVIS_SHORTCUTS.find(entry => entry.key === 'x' && entry.shiftKey);

    expect(shortcut).toMatchObject({
      name: 'Collapse All Processes',
      description: 'Collapse all processes.',
      commandId: 'trace.collapse-all-processes',
      displayPair: {
        id: 'tracevis-process-expansion',
        position: 'secondary',
        description: 'Expand all with X / collapse all with Shift+X.'
      }
    });

    commandManager.executeCommand(shortcut!.commandId!);
    expect(expandAllProcesses).toHaveBeenCalledWith(false);
  });

  it('exposes process expansion commands to users and automation', () => {
    expect(commandManager.getCommand('trace.expand-all-processes')).toMatchObject({
      exposure: 'all'
    });
    expect(commandManager.getCommand('trace.collapse-all-processes')).toMatchObject({
      exposure: 'all'
    });
  });

  it('routes navigation shortcuts through the imperative deck controller', () => {
    const panLeft = vi.spyOn(imperativeDeckController, 'panLeft');
    const panRight = vi.spyOn(imperativeDeckController, 'panRight');
    const panUp = vi.spyOn(imperativeDeckController, 'panUp');
    const panDown = vi.spyOn(imperativeDeckController, 'panDown');
    const panUpFast = vi.spyOn(imperativeDeckController, 'panUpFast');
    const panDownFast = vi.spyOn(imperativeDeckController, 'panDownFast');
    const zoomInHorizontal = vi.spyOn(imperativeDeckController, 'zoomInHorizontal');
    const zoomOutHorizontal = vi.spyOn(imperativeDeckController, 'zoomOutHorizontal');

    for (const shortcut of [
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'a'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'd'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'w'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 's'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowLeft'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowRight'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowUp'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowDown'),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowUp' && entry.shiftKey),
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowDown' && entry.shiftKey)
    ]) {
      commandManager.executeCommand(shortcut!.commandId!);
    }

    expect(panLeft).toHaveBeenCalledTimes(2);
    expect(panRight).toHaveBeenCalledTimes(2);
    expect(panUp).toHaveBeenCalledOnce();
    expect(panDown).toHaveBeenCalledOnce();
    expect(panUpFast).toHaveBeenCalledOnce();
    expect(panDownFast).toHaveBeenCalledOnce();
    expect(zoomInHorizontal).toHaveBeenCalledOnce();
    expect(zoomOutHorizontal).toHaveBeenCalledOnce();
  });

  it('shows the plain slash shortcut for visible span search', () => {
    const shortcut = TRACEVIS_SHORTCUTS.find(entry => entry.key === '/' && !entry.commandKey);

    expect(shortcut).toMatchObject({
      name: 'Search Visible Spans',
      description: 'Search and navigate to visible spans.',
      badges: ['perfetto'],
      displaySection: 'interaction'
    });
  });

  it('marks perfetto-style navigation shortcuts with a compatibility badge', () => {
    const perfettoCompatKeys = [
      ...TRACEVIS_SHORTCUTS.filter(
        entry => entry.key !== '' && entry.badges?.includes('perfetto')
      ).map(entry => entry.key)
    ];

    for (const key of perfettoCompatKeys) {
      expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === key)?.badges).toContain('perfetto');
    }
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === '' && entry.dragMouse)?.badges).toContain(
      'perfetto'
    );
    expect(
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowUp' && entry.shiftKey)?.badges
    ).toBeUndefined();
    expect(
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowDown' && entry.shiftKey)?.badges
    ).toBeUndefined();
  });

  it('shows drag interactions as trackpad-only display chips', () => {
    const dragInteraction = TRACEVIS_SHORTCUTS.find(entry => entry.name === 'Drag Interaction');
    const measureTime = TRACEVIS_SHORTCUTS.find(entry => entry.name === 'Measure Time');
    const selectBlock = TRACEVIS_SHORTCUTS.find(entry => entry.name === 'Select Block');
    const selectDependentBlocks = TRACEVIS_SHORTCUTS.find(
      entry => entry.name === 'Select Dependent Blocks'
    );

    expect(dragInteraction?.displayInputs).toEqual([
      {
        kind: 'trackpad',
        label: 'press + drag',
        icon: 'trackpad-pan'
      }
    ]);
    expect(measureTime?.displayInputs).toEqual([
      {
        kind: 'trackpad',
        label: 'drag',
        modifiers: ['shift'],
        icon: 'trackpad-pan'
      }
    ]);
    expect(measureTime?.displaySection).toBe('interaction');
    expect(selectBlock?.displayInputs).toEqual([
      {
        kind: 'trackpad',
        label: 'click',
        icon: 'trackpad-click'
      }
    ]);
    expect(selectDependentBlocks?.displayInputs).toEqual([
      {
        kind: 'trackpad',
        label: 'click',
        modifiers: ['shift'],
        icon: 'trackpad-click'
      }
    ]);
  });

  it('adds paired display metadata for related navigation shortcuts', () => {
    expect(
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'x' && !entry.shiftKey)?.displayPair
    ).toMatchObject({
      id: 'tracevis-process-expansion',
      position: 'primary',
      description: 'Expand all with X / collapse all with Shift+X.'
    });
    expect(
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'x' && entry.shiftKey)?.displayPair
    ).toMatchObject({
      id: 'tracevis-process-expansion',
      position: 'secondary',
      description: 'Expand all with X / collapse all with Shift+X.'
    });
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 'a')?.displayPair).toMatchObject({
      id: 'tracevis-pan-horizontal-wasd',
      position: 'primary',
      description: 'Pan horizontally with A / D.'
    });
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 'd')?.displayPair).toMatchObject({
      id: 'tracevis-pan-horizontal-wasd',
      position: 'secondary',
      description: 'Pan horizontally with A / D.'
    });
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 'w')?.displayPair).toMatchObject({
      id: 'tracevis-zoom-horizontal',
      position: 'primary',
      description: 'Zoom horizontally with W / S.'
    });
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 's')?.displayPair).toMatchObject({
      id: 'tracevis-zoom-horizontal',
      position: 'secondary',
      description: 'Zoom horizontally with W / S.'
    });
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowLeft')?.displayPair).toMatchObject({
      id: 'tracevis-pan-horizontal-arrows',
      position: 'primary',
      description: 'Pan horizontally with left / right arrows.'
    });
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowRight')?.displayPair).toMatchObject(
      {
        id: 'tracevis-pan-horizontal-arrows',
        position: 'secondary',
        description: 'Pan horizontally with left / right arrows.'
      }
    );
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowUp')?.displayPair).toMatchObject({
      id: 'tracevis-pan-vertical-arrows',
      position: 'primary',
      description: 'Pan vertically with up / down arrows.'
    });
    expect(TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowDown')?.displayPair).toMatchObject({
      id: 'tracevis-pan-vertical-arrows',
      position: 'secondary',
      description: 'Pan vertically with up / down arrows.'
    });
    expect(
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowUp' && entry.shiftKey)?.displayPair
    ).toMatchObject({
      id: 'tracevis-pan-fast-vertical-arrows',
      position: 'primary',
      description: 'Pan vertically faster with Shift+up / Shift+down arrows.'
    });
    expect(
      TRACEVIS_SHORTCUTS.find(entry => entry.key === 'ArrowDown' && entry.shiftKey)?.displayPair
    ).toMatchObject({
      id: 'tracevis-pan-fast-vertical-arrows',
      position: 'secondary',
      description: 'Pan vertically faster with Shift+up / Shift+down arrows.'
    });
  });
});
