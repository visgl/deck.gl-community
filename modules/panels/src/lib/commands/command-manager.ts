/** Caller-provided payload passed into command execution and undo handlers. */
export type CommandState = Record<string, unknown>;

/** Minimal parser contract used to validate command arguments without coupling to one schema lib. */
export type CommandArgsSchema = {
  /** Parses one unknown argument payload. */
  safeParse: (value: unknown) =>
    | {
        /** Whether parsing succeeded. */
        success: true;
        /** Parsed command arguments. */
        data: CommandState;
      }
    | {
        /** Whether parsing succeeded. */
        success: false;
        /** Parser-specific validation details. */
        error: unknown;
      };
};

/** Defines one named command implementation. */
export type CommandDefinition = {
  /** Stable command identifier used by shortcuts and widgets. */
  id: string;
  /** Human-readable command label used by automation and help surfaces. */
  label?: string;
  /** Longer command description used by automation and help surfaces. */
  description?: string;
  /** Visibility policy for user-facing UI surfaces and external automation. */
  exposure?: 'user' | 'automation' | 'all';
  /** Optional schema used to validate command arguments before execution. */
  argsSchema?: CommandArgsSchema;
  /** Runtime guard for whether the command may execute with the current app state. */
  isEnabled?: (state?: CommandState) => boolean;
  /** Executes the command with optional caller-provided state. */
  do: (state?: CommandState) => unknown | Promise<unknown>;
  /** Reverses the command with optional caller-provided state. */
  undo?: (state?: CommandState) => unknown | Promise<unknown>;
};

/** Public command metadata derived from a command definition, without handlers or raw schemas. */
export type CommandDescriptor = Pick<CommandDefinition, 'id' | 'label' | 'description'> & {
  /** Visibility policy for user-facing UI surfaces and external automation. */
  exposure: NonNullable<CommandDefinition['exposure']>;
  /** Whether the command has an argument schema. */
  acceptsArgs: boolean;
  /** Whether the command is enabled before evaluating any caller-provided args. */
  isEnabled: boolean;
};

/** Host-provided automation surface metadata rendered in command documentation. */
export type CommandAutomationSupport = {
  /** Stable automation surface id. */
  id: string;
  /** Human-readable automation surface label. */
  label: string;
  /** Brief description of what the automation surface exposes. */
  description?: string;
  /** Browser global name, when the host installs one. */
  globalName?: string;
  /** postMessage request type, when the host supports message-based commands. */
  requestType?: string;
  /** postMessage response type, when the host supports message-based commands. */
  responseType?: string;
};

/** Options for installing a host automation global. */
export type InstallCommandAutomationOptions = Omit<
  CommandAutomationSupport,
  'id' | 'label' | 'globalName'
> & {
  /** Stable automation surface id. Defaults to the global name. */
  id?: string;
  /** Human-readable automation surface label. Defaults to the global name. */
  label?: string;
  /** Object receiving the automation global. Defaults to `globalThis`. */
  target?: Record<string, unknown>;
};

/** Filter options for command listing. */
export type ListCommandsOptions = {
  /** Optional exposure filter. */
  exposure?: CommandDescriptor['exposure'];
};

/** Options for structured async command execution. */
export type ExecuteCommandAsyncOptions = {
  /** Required command exposure for this execution path. */
  exposure?: CommandDescriptor['exposure'];
};

/** Registry and dispatcher for app commands shared by shortcuts and widgets. */
export class CommandManager {
  /** Registered command implementations keyed by stable command id. */
  readonly #commands = new Map<string, CommandDefinition>();
  /** Registered host automation surfaces keyed by stable surface id. */
  readonly #automationSupport = new Map<string, CommandAutomationSupport>();

  /** Registers or replaces one command implementation. */
  registerCommand(command: CommandDefinition): () => void {
    this.#commands.set(command.id, command);
    return () => {
      if (this.#commands.get(command.id) === command) {
        this.#commands.delete(command.id);
      }
    };
  }

  /** Returns whether a command id currently has an implementation. */
  hasCommand(id: string): boolean {
    return this.#commands.has(id);
  }

  /** Installs one host automation global and returns a cleanup callback. */
  installAutomation(
    globalName: string,
    value: unknown,
    options: InstallCommandAutomationOptions
  ): () => void {
    const target = options.target ?? (globalThis as unknown as Record<string, unknown>);
    const support = {
      id: options.id ?? globalName,
      label: options.label ?? globalName,
      description: options.description,
      globalName,
      requestType: options.requestType,
      responseType: options.responseType
    };
    target[globalName] = value;
    this.#automationSupport.set(support.id, support);
    return () => {
      if (this.#automationSupport.get(support.id) === support) {
        this.#automationSupport.delete(support.id);
      }
      if (target[globalName] === value) {
        delete target[globalName];
      }
    };
  }

  /** Lists host automation surfaces known to this command manager. */
  listAutomationSupport(): CommandAutomationSupport[] {
    return [...this.#automationSupport.values()].map(support => ({...support}));
  }

  /** Lists command metadata, optionally filtered by exposure. */
  listCommands(options: ListCommandsOptions = {}): CommandDescriptor[] {
    const commands: CommandDescriptor[] = [];
    for (const command of this.#commands.values()) {
      const exposure = command.exposure ?? 'user';
      const descriptor = {
        id: command.id,
        label: command.label,
        description: command.description,
        exposure,
        acceptsArgs: Boolean(command.argsSchema),
        isEnabled: command.isEnabled ? command.isEnabled() : true
      };
      const matchesExposure =
        !options.exposure ||
        exposure === options.exposure ||
        (exposure === 'all' && options.exposure !== 'all');
      if (!matchesExposure) {
        continue;
      }
      commands.push(descriptor);
    }
    return commands;
  }

  /** Returns public command metadata for one command id. */
  getCommand(id: string): CommandDescriptor | null {
    const command = this.#commands.get(id);
    return command
      ? {
          id: command.id,
          label: command.label,
          description: command.description,
          exposure: command.exposure ?? 'user',
          acceptsArgs: Boolean(command.argsSchema),
          isEnabled: command.isEnabled ? command.isEnabled() : true
        }
      : null;
  }

  /** Executes a registered command and returns the handler result or an error. */
  executeCommand(id: string, state?: CommandState): unknown | Error {
    const command = this.#commands.get(id);
    if (!command) {
      return new Error(`Command not found: ${id}`);
    }
    let parsedState = state;
    if (command.argsSchema) {
      const parsed = command.argsSchema.safeParse(state);
      if (parsed.success === false) {
        return new Error(`Invalid arguments for command: ${id}`, {cause: parsed.error});
      }
      parsedState = parsed.data;
    }
    if (command.isEnabled && !command.isEnabled(parsedState)) {
      return new Error(`Command is disabled: ${id}`);
    }
    try {
      return command.do(parsedState);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error), {cause: error});
    }
  }

  /** Executes a registered command's undo handler and returns the handler result or an error. */
  undoCommand(id: string, state?: CommandState): unknown | Error {
    const command = this.#commands.get(id);
    if (!command) {
      return new Error(`Command not found: ${id}`);
    }
    if (!command.undo) {
      return new Error(`Command has no undo handler: ${id}`);
    }
    try {
      return command.undo(state);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error), {cause: error});
    }
  }

  /** Executes a command asynchronously and returns the awaited handler result or an error. */
  async executeCommandAsync(
    id: string,
    state?: CommandState,
    options: ExecuteCommandAsyncOptions = {}
  ): Promise<unknown | Error> {
    const command = this.#commands.get(id);
    if (!command) {
      return new Error(`Command not found: ${id}`);
    }
    const exposure = command.exposure ?? 'user';
    const matchesExposure =
      !options.exposure ||
      exposure === options.exposure ||
      (exposure === 'all' && options.exposure !== 'all');
    if (!matchesExposure) {
      return new Error(`Command is not exposed as ${options.exposure}.`);
    }

    let parsedState = state;
    if (command.argsSchema) {
      const parsed = command.argsSchema.safeParse(state);
      if (parsed.success === false) {
        return new Error(`Invalid arguments for command: ${id}`, {cause: parsed.error});
      }
      parsedState = parsed.data;
    }

    if (command.isEnabled && !command.isEnabled(parsedState)) {
      return new Error(`Command is disabled: ${id}`);
    }

    try {
      return await command.do(parsedState);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error), {cause: error});
    }
  }
}

/** Shared command manager used by deck widgets and shortcut bindings. */
export const commandManager = new CommandManager();
