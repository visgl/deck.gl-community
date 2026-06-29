import {describe, expect, it, vi} from 'vitest';
import {z} from 'zod';

import {CommandManager} from './command-manager';

describe('CommandManager', () => {
  it('lists command metadata and filters by exposure', () => {
    const manager = new CommandManager();
    manager.registerCommand({
      id: 'test.user',
      label: 'User',
      do: () => undefined
    });
    manager.registerCommand({
      id: 'test.automation',
      label: 'Automation',
      description: 'Externally visible test command.',
      exposure: 'automation',
      argsSchema: z.object({value: z.string()}),
      do: () => undefined
    });
    manager.registerCommand({
      id: 'test.all',
      label: 'All',
      exposure: 'all',
      do: () => undefined
    });

    expect(manager.listCommands()).toEqual([
      {
        id: 'test.user',
        label: 'User',
        description: undefined,
        exposure: 'user',
        acceptsArgs: false,
        isEnabled: true
      },
      {
        id: 'test.automation',
        label: 'Automation',
        description: 'Externally visible test command.',
        exposure: 'automation',
        acceptsArgs: true,
        isEnabled: true
      },
      {
        id: 'test.all',
        label: 'All',
        description: undefined,
        exposure: 'all',
        acceptsArgs: false,
        isEnabled: true
      }
    ]);
    expect(manager.listCommands({exposure: 'user'}).map(command => command.id)).toEqual([
      'test.user',
      'test.all'
    ]);
    expect(manager.listCommands({exposure: 'automation'}).map(command => command.id)).toEqual([
      'test.automation',
      'test.all'
    ]);
    expect(manager.getCommand('test.automation')).toMatchObject({
      id: 'test.automation',
      exposure: 'automation',
      acceptsArgs: true
    });
  });

  it('executes and undoes synchronous commands', () => {
    const manager = new CommandManager();
    const handleDo = vi.fn();
    const handleUndo = vi.fn();
    const state = {source: 'test'};

    manager.registerCommand({
      id: 'test.sync',
      do: handleDo,
      undo: handleUndo
    });

    manager.executeCommand('test.sync', state);
    manager.undoCommand('test.sync', state);
    manager.executeCommand('test.missing', state);
    manager.undoCommand('test.missing', state);

    expect(handleDo).toHaveBeenCalledTimes(1);
    expect(handleDo).toHaveBeenCalledWith(state);
    expect(handleUndo).toHaveBeenCalledTimes(1);
    expect(handleUndo).toHaveBeenCalledWith(state);
  });

  it('unregisters only the command implementation that created the cleanup callback', () => {
    const manager = new CommandManager();
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = manager.registerCommand({id: 'test.replace', do: first});
    const unregisterSecond = manager.registerCommand({id: 'test.replace', do: second});

    unregisterFirst();
    manager.executeCommand('test.replace');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unregisterSecond();
    expect(manager.hasCommand('test.replace')).toBe(false);
  });

  it('installs automation globals and records support metadata', () => {
    const manager = new CommandManager();
    const target: Record<string, unknown> = {};
    const facade = {version: 1};
    const uninstall = manager.installAutomation('deckTools', facade, {
      id: 'test.deck-tools',
      label: 'Deck tools automation',
      requestType: 'deck-tools:command',
      responseType: 'deck-tools:result',
      target
    });

    expect(target.deckTools).toBe(facade);
    expect(manager.listAutomationSupport()).toEqual([
      {
        id: 'test.deck-tools',
        label: 'Deck tools automation',
        description: undefined,
        globalName: 'deckTools',
        requestType: 'deck-tools:command',
        responseType: 'deck-tools:result'
      }
    ]);

    uninstall();

    expect(target.deckTools).toBeUndefined();
    expect(manager.listAutomationSupport()).toEqual([]);
  });

  it('executes automation commands with parsed arguments', async () => {
    const manager = new CommandManager();
    manager.registerCommand({
      id: 'test.echo',
      exposure: 'automation',
      argsSchema: z.object({value: z.string()}),
      do: args => ({echoed: args?.value})
    });

    await expect(
      manager.executeCommandAsync('test.echo', {value: 'ok'}, {exposure: 'automation'})
    ).resolves.toEqual({echoed: 'ok'});
  });

  it('rejects commands that are missing, user-only, invalid, disabled, or throwing', async () => {
    const manager = new CommandManager();
    manager.registerCommand({id: 'test.user', do: () => undefined});
    manager.registerCommand({
      id: 'test.invalid',
      exposure: 'automation',
      argsSchema: z.object({value: z.string()}),
      do: () => undefined
    });
    manager.registerCommand({
      id: 'test.disabled',
      exposure: 'automation',
      isEnabled: () => false,
      do: () => undefined
    });
    manager.registerCommand({
      id: 'test.throwing',
      exposure: 'automation',
      do: () => {
        throw new Error('boom');
      }
    });

    const missingResult = await manager.executeCommandAsync(
      'test.missing',
      {},
      {exposure: 'automation'}
    );
    expect(missingResult).toMatchObject({
      message: 'Command not found: test.missing'
    });

    const userOnlyResult = await manager.executeCommandAsync(
      'test.user',
      {},
      {exposure: 'automation'}
    );
    expect(userOnlyResult).toMatchObject({
      message: 'Command is not exposed as automation.'
    });

    const invalidResult = await manager.executeCommandAsync(
      'test.invalid',
      {value: 1},
      {exposure: 'automation'}
    );
    expect(invalidResult).toMatchObject({
      message: 'Invalid arguments for command: test.invalid'
    });
    expect(invalidResult).toBeInstanceOf(Error);
    expect((invalidResult as Error).cause).toBeInstanceOf(Error);

    const disabledResult = await manager.executeCommandAsync(
      'test.disabled',
      {},
      {exposure: 'automation'}
    );
    expect(disabledResult).toMatchObject({
      message: 'Command is disabled: test.disabled'
    });

    const throwingResult = await manager.executeCommandAsync(
      'test.throwing',
      {},
      {exposure: 'automation'}
    );
    expect(throwingResult).toMatchObject({
      message: 'boom'
    });
  });
});
