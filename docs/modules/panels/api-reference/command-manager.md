# CommandManager

<p className="badges">
  <img src="https://img.shields.io/badge/from-v9.3-green.svg?style=flat-square" alt="from v9.3" />
</p>

`CommandManager` is a shared command registry for shortcuts, widgets, and host
automation surfaces. It stores command metadata separately from command
handlers so UI surfaces can list commands without receiving the raw
implementations.

## Import

```ts
import {
  CommandManager,
  commandManager,
  type CommandDefinition,
  type CommandDescriptor
} from '@deck.gl-community/panels';
```

## Usage

```ts
const manager = new CommandManager();

const unregister = manager.registerCommand({
  id: 'view.reset',
  label: 'Reset view',
  description: 'Reset the current viewport.',
  do: () => resetView()
});

manager.executeCommand('view.reset');
unregister();
```

## Automation

Commands default to `exposure: 'user'`. Use `exposure: 'automation'` or
`exposure: 'all'` when a host automation surface should be able to execute a
command through `executeCommandAsync`.

```ts
manager.registerCommand({
  id: 'selection.clear',
  label: 'Clear selection',
  exposure: 'all',
  do: () => clearSelection()
});
```

## Remarks

- `listCommands({exposure: 'user'})` includes user commands and commands with
  `exposure: 'all'`.
- `executeCommandAsync` validates command exposure and optional argument
  schemas before invoking a command.
- `installAutomation` records host-provided automation surfaces for docs or
  command help panels.
