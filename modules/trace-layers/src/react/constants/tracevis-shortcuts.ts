import {imperativeDeckController} from '../../layers/index';
import {commandManager} from '@deck.gl-community/panels';

import type {CommandDefinition, KeyboardShortcut} from '@deck.gl-community/panels';

const PERFETTO_COMPAT_BADGE = ['perfetto'];
const HORIZONTAL_PAN_WASD_PAIR = {
  id: 'tracevis-pan-horizontal-wasd',
  description: 'Pan horizontally with A / D.'
};
const HORIZONTAL_ZOOM_PAIR = {
  id: 'tracevis-zoom-horizontal',
  description: 'Zoom horizontally with W / S.'
};
const HORIZONTAL_PAN_ARROW_PAIR = {
  id: 'tracevis-pan-horizontal-arrows',
  description: 'Pan horizontally with left / right arrows.'
};
const VERTICAL_PAN_ARROW_PAIR = {
  id: 'tracevis-pan-vertical-arrows',
  description: 'Pan vertically with up / down arrows.'
};
const FAST_VERTICAL_PAN_ARROW_PAIR = {
  id: 'tracevis-pan-fast-vertical-arrows',
  description: 'Pan vertically faster with Shift+up / Shift+down arrows.'
};
const PROCESS_EXPANSION_PAIR = {
  id: 'tracevis-process-expansion',
  description: 'Expand all with X / collapse all with Shift+X.'
};
const EXPAND_ALL_PROCESSES_COMMAND_ID = 'trace.expand-all-processes';
const COLLAPSE_ALL_PROCESSES_COMMAND_ID = 'trace.collapse-all-processes';
const PAN_LEFT_COMMAND_ID = 'trace.pan-left';
const PAN_RIGHT_COMMAND_ID = 'trace.pan-right';
const PAN_UP_COMMAND_ID = 'trace.pan-up';
const PAN_DOWN_COMMAND_ID = 'trace.pan-down';
const PAN_UP_FAST_COMMAND_ID = 'trace.pan-up-fast';
const PAN_DOWN_FAST_COMMAND_ID = 'trace.pan-down-fast';
const ZOOM_IN_HORIZONTAL_COMMAND_ID = 'trace.zoom-in-horizontal';
const ZOOM_OUT_HORIZONTAL_COMMAND_ID = 'trace.zoom-out-horizontal';

const TRACEVIS_SHORTCUT_COMMANDS = [
  {
    id: EXPAND_ALL_PROCESSES_COMMAND_ID,
    label: 'Expand all processes',
    description: 'Expands all trace processes.',
    exposure: 'all',
    do: () => imperativeDeckController.expandAllProcesses(true)
  },
  {
    id: COLLAPSE_ALL_PROCESSES_COMMAND_ID,
    label: 'Collapse all processes',
    description: 'Collapses all trace processes.',
    exposure: 'all',
    do: () => imperativeDeckController.expandAllProcesses(false)
  },
  {
    id: PAN_LEFT_COMMAND_ID,
    label: 'Pan left',
    description: 'Pans the trace viewport earlier in time.',
    exposure: 'automation',
    do: () => imperativeDeckController.panLeft()
  },
  {
    id: PAN_RIGHT_COMMAND_ID,
    label: 'Pan right',
    description: 'Pans the trace viewport later in time.',
    exposure: 'automation',
    do: () => imperativeDeckController.panRight()
  },
  {
    id: PAN_UP_COMMAND_ID,
    label: 'Pan up',
    description: 'Pans the trace viewport up.',
    exposure: 'automation',
    do: () => imperativeDeckController.panUp()
  },
  {
    id: PAN_DOWN_COMMAND_ID,
    label: 'Pan down',
    description: 'Pans the trace viewport down.',
    exposure: 'automation',
    do: () => imperativeDeckController.panDown()
  },
  {
    id: PAN_UP_FAST_COMMAND_ID,
    label: 'Pan up fast',
    description: 'Pans the trace viewport up faster.',
    exposure: 'automation',
    do: () => imperativeDeckController.panUpFast()
  },
  {
    id: PAN_DOWN_FAST_COMMAND_ID,
    label: 'Pan down fast',
    description: 'Pans the trace viewport down faster.',
    exposure: 'automation',
    do: () => imperativeDeckController.panDownFast()
  },
  {
    id: ZOOM_IN_HORIZONTAL_COMMAND_ID,
    label: 'Zoom in horizontally',
    description: 'Zooms into the trace timeline horizontally.',
    exposure: 'automation',
    do: () => imperativeDeckController.zoomInHorizontal()
  },
  {
    id: ZOOM_OUT_HORIZONTAL_COMMAND_ID,
    label: 'Zoom out horizontally',
    description: 'Zooms out of the trace timeline horizontally.',
    exposure: 'automation',
    do: () => imperativeDeckController.zoomOutHorizontal()
  }
] satisfies readonly CommandDefinition[];

TRACEVIS_SHORTCUT_COMMANDS.forEach(command => {
  commandManager.registerCommand(command);
});

/** Default Tracevis keyboard shortcuts registered by the graph widget and app shell. */
export const TRACEVIS_SHORTCUTS: KeyboardShortcut[] = [
  {
    key: '',
    name: 'Swipe Interaction',
    description: 'Pan or Zoom - Settings/Application/Interaction.',
    displayInputs: [
      {
        kind: 'trackpad',
        label: 'two-finger swipe',
        icon: 'trackpad-zoom'
      }
    ]
  },
  {
    key: '',
    name: 'Drag Interaction',
    description: 'Zoom or Pan - Settings/Application/Interaction.',
    displayInputs: [
      {
        kind: 'trackpad',
        label: 'press + drag',
        icon: 'trackpad-pan'
      }
    ]
  },
  {
    key: '',
    name: 'Select Block',
    description: 'Select a block and open the span inspector.',
    displaySection: 'interaction',
    displayInputs: [
      {
        kind: 'trackpad',
        label: 'click',
        icon: 'trackpad-click'
      }
    ]
  },
  {
    key: '',
    shiftKey: true,
    name: 'Select Dependent Blocks',
    description: 'Select a block and hide non-dependent spans.',
    displaySection: 'interaction',
    displayInputs: [
      {
        kind: 'trackpad',
        label: 'click',
        modifiers: ['shift'],
        icon: 'trackpad-click'
      }
    ]
  },
  // MeasureTimeWidget bindings
  {
    key: 'x',
    name: 'Expand All Processes',
    description: 'Expand all processes.',
    displayPair: {
      ...PROCESS_EXPANSION_PAIR,
      position: 'primary'
    },
    commandId: EXPAND_ALL_PROCESSES_COMMAND_ID
  },
  {
    key: 'x',
    shiftKey: true,
    name: 'Collapse All Processes',
    description: 'Collapse all processes.',
    displayPair: {
      ...PROCESS_EXPANSION_PAIR,
      position: 'secondary'
    },
    commandId: COLLAPSE_ALL_PROCESSES_COMMAND_ID
  },
  {
    key: '',
    shiftKey: true,
    dragMouse: true,
    name: 'Measure Time',
    description: 'Measure time between two points',
    badges: PERFETTO_COMPAT_BADGE,
    displaySection: 'interaction',
    displayInputs: [
      {
        kind: 'trackpad',
        label: 'drag',
        modifiers: ['shift'],
        icon: 'trackpad-pan'
      }
    ]
  },
  {
    key: '/',
    name: 'Search Visible Spans',
    description: 'Search and navigate to visible spans.',
    badges: PERFETTO_COMPAT_BADGE,
    displaySection: 'interaction'
  },
  // Perfetto style bindings
  {
    key: 'a',
    name: 'Pan Left',
    description: 'Pan Left (Earlier in time)',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...HORIZONTAL_PAN_WASD_PAIR,
      position: 'primary'
    },
    commandId: PAN_LEFT_COMMAND_ID
  },
  {
    key: 'd',
    name: 'Pan Right',
    description: 'Pan Right (Later in time)',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...HORIZONTAL_PAN_WASD_PAIR,
      position: 'secondary'
    },
    commandId: PAN_RIGHT_COMMAND_ID
  },
  {
    key: 'w',
    name: 'Zoom In',
    description: 'Zoom In',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...HORIZONTAL_ZOOM_PAIR,
      position: 'primary'
    },
    commandId: ZOOM_IN_HORIZONTAL_COMMAND_ID
  },
  {
    key: 's',
    name: 'Zoom Out',
    description: 'Zoom Out',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...HORIZONTAL_ZOOM_PAIR,
      position: 'secondary'
    },
    commandId: ZOOM_OUT_HORIZONTAL_COMMAND_ID
  },
  {
    key: 'ArrowLeft',
    name: 'Pan Left',
    description: 'Pan Left (Earlier in time)',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...HORIZONTAL_PAN_ARROW_PAIR,
      position: 'primary'
    },
    preventDefault: true,
    commandId: PAN_LEFT_COMMAND_ID
  },
  {
    key: 'ArrowRight',
    name: 'Pan Right',
    description: 'Pan Right (Later in time)',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...HORIZONTAL_PAN_ARROW_PAIR,
      position: 'secondary'
    },
    preventDefault: true,
    commandId: PAN_RIGHT_COMMAND_ID
  },
  {
    key: 'ArrowUp',
    name: 'Pan Up',
    description: 'Pan Up',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...VERTICAL_PAN_ARROW_PAIR,
      position: 'primary'
    },
    preventDefault: true,
    commandId: PAN_UP_COMMAND_ID
  },
  {
    key: 'ArrowDown',
    name: 'Pan Down',
    description: 'Pan Down',
    badges: PERFETTO_COMPAT_BADGE,
    displayPair: {
      ...VERTICAL_PAN_ARROW_PAIR,
      position: 'secondary'
    },
    preventDefault: true,
    commandId: PAN_DOWN_COMMAND_ID
  },
  {
    key: 'ArrowUp',
    shiftKey: true,
    name: 'Pan Up Fast',
    description: 'Pan Up Faster',
    displayPair: {
      ...FAST_VERTICAL_PAN_ARROW_PAIR,
      position: 'primary'
    },
    preventDefault: true,
    commandId: PAN_UP_FAST_COMMAND_ID
  },
  {
    key: 'ArrowDown',
    shiftKey: true,
    name: 'Pan Down Fast',
    description: 'Pan Down Faster',
    displayPair: {
      ...FAST_VERTICAL_PAN_ARROW_PAIR,
      position: 'secondary'
    },
    preventDefault: true,
    commandId: PAN_DOWN_FAST_COMMAND_ID
  }
];
