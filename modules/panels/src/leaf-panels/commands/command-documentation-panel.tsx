/** @jsxImportSource preact */

import {Panel} from '../../panels/panel';

import type {CommandDescriptor, CommandManager} from '../../lib/commands/command-manager';
import type {PanelTheme} from '../../panels/panel';
import type {JSX} from 'preact';

/** Props used to construct a command documentation panel. */
export type CommandDocumentationPanelProps = {
  /** Command manager whose registered command metadata is rendered. */
  manager: CommandManager;
  /** Optional panel theme override. */
  theme?: PanelTheme;
};

/**
 * A panel definition that renders command metadata from a command manager.
 */
export class CommandDocumentationPanel extends Panel {
  /**
   * Creates a command documentation panel.
   */
  constructor({manager, theme = 'inherit'}: CommandDocumentationPanelProps) {
    super({
      id: 'command-documentation',
      title: 'Commands',
      theme,
      content: <CommandDocumentationPanelContent manager={manager} />
    });
  }
}

/** Renders command metadata or an empty state. */
function CommandDocumentationPanelContent({
  manager
}: {
  /** Command manager whose command metadata is rendered. */
  manager: CommandManager;
}) {
  const commandRows = buildCommandDocumentationRows(manager.listCommands());
  const automationSupport = manager.listAutomationSupport();
  const exampleAutomationCommand = manager.listCommands({exposure: 'automation'})[0];
  if (commandRows.length === 0) {
    return (
      <div style={EMPTY_STATE_STYLE}>
        <strong>No commands registered.</strong>
        <span>Commands registered with the command manager will appear here.</span>
      </div>
    );
  }

  return (
    <div style={COMMAND_LIST_STYLE}>
      <div style={INTRO_STYLE}>
        <ul style={INTRO_LIST_STYLE}>
          <li>User commands can be executed via the Search box (Omnibox).</li>
          <li>Automation commands can be executed programmatically, see bottom of page.</li>
        </ul>
      </div>
      <div style={COMMAND_TABLE_WRAPPER_STYLE}>
        <table style={COMMAND_TABLE_STYLE}>
          <thead>
            <tr>
              <th style={COMMAND_HEADER_CELL_STYLE}>Command</th>
              <th style={COMMAND_CENTER_HEADER_CELL_STYLE}>User</th>
              <th style={COMMAND_CENTER_HEADER_CELL_STYLE}>Automation</th>
            </tr>
          </thead>
          <tbody>
            {commandRows.map(command => (
              <tr key={command.ids.join('\n')}>
                <td style={COMMAND_CELL_STYLE}>
                  {command.label ? (
                    <div style={COMMAND_LABEL_STYLE}>{command.label}</div>
                  ) : (
                    <code style={COMMAND_LABEL_ID_STYLE}>{command.ids[0]}</code>
                  )}
                  {command.description ? (
                    <div style={COMMAND_DESCRIPTION_STYLE}>{command.description}</div>
                  ) : null}
                  {command.label
                    ? command.ids.map(id => (
                        <code key={id} style={COMMAND_ID_STYLE}>
                          {id}
                        </code>
                      ))
                    : null}
                </td>
                <td style={COMMAND_CENTER_CELL_STYLE}>
                  {renderAvailabilityIndicator(command.userAvailable)}
                </td>
                <td style={COMMAND_CENTER_CELL_STYLE}>
                  {renderAvailabilityIndicator(command.automationAvailable)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {automationSupport.length ? (
        <div style={POSTMESSAGE_SECTION_STYLE}>
          <strong>Installed automation</strong>
          {automationSupport.map(support => (
            <div key={support.id} style={AUTOMATION_SUPPORT_STYLE}>
              <span>
                <strong>{support.label}</strong>
                {support.globalName ? (
                  <>
                    {' '}
                    via <code style={INLINE_CODE_STYLE}>globalThis.{support.globalName}</code>
                  </>
                ) : null}
              </span>
              {support.description ? <span>{support.description}</span> : null}
              {support.requestType && support.responseType ? (
                <span>
                  postMessage requests use{' '}
                  <code style={INLINE_CODE_STYLE}>{support.requestType}</code> and responses use{' '}
                  <code style={INLINE_CODE_STYLE}>{support.responseType}</code>.
                </span>
              ) : null}
              {support.globalName && exampleAutomationCommand ? (
                <code style={COMMAND_EXAMPLE_STYLE}>
                  await globalThis.{support.globalName}.commands.execute('
                  {exampleAutomationCommand.id}');
                </code>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Render-ready command documentation row, with duplicate command ids merged. */
type CommandDocumentationRow = {
  /** Command ids represented by this row. */
  ids: string[];
  /** Human-readable command label. */
  label?: string;
  /** Optional command description. */
  description?: string;
  /** Whether any represented command is user-facing. */
  userAvailable: boolean;
  /** Whether any represented command is automation-facing. */
  automationAvailable: boolean;
};

/** Builds command docs rows with user-available commands before automation-only commands. */
function buildCommandDocumentationRows(commands: CommandDescriptor[]): CommandDocumentationRow[] {
  const rows = mergeEquivalentCommands(commands);
  const userRows = rows.filter(row => row.userAvailable);
  const automationOnlyRows = rows.filter(row => !row.userAvailable);
  return [...userRows, ...automationOnlyRows];
}

/** Merges command ids that describe the same user-visible action. */
function mergeEquivalentCommands(commands: CommandDescriptor[]): CommandDocumentationRow[] {
  const rows: CommandDocumentationRow[] = [];
  const rowsByKey = new Map<string, CommandDocumentationRow>();

  for (const command of commands) {
    const key = getCommandDocumentationMergeKey(command);
    const existingRow = key ? rowsByKey.get(key) : undefined;
    if (existingRow) {
      existingRow.ids.push(command.id);
      existingRow.userAvailable ||= isUserCommand(command);
      existingRow.automationAvailable ||= isAutomationCommand(command);
      continue;
    }

    const row = {
      ids: [command.id],
      label: command.label,
      description: command.description,
      userAvailable: isUserCommand(command),
      automationAvailable: isAutomationCommand(command)
    };
    rows.push(row);
    if (key) {
      rowsByKey.set(key, row);
    }
  }

  return rows;
}

/** Returns a merge key only when a command has enough display metadata to identify an action. */
function getCommandDocumentationMergeKey(command: CommandDescriptor): string | null {
  if (!command.label) {
    return null;
  }
  return `${command.label}\n${command.description ?? ''}`;
}

/** Returns whether a command is available to user-facing surfaces. */
function isUserCommand(command: CommandDescriptor): boolean {
  return command.exposure === 'user' || command.exposure === 'all';
}

/** Returns whether a command is available to external automation surfaces. */
function isAutomationCommand(command: CommandDescriptor): boolean {
  return command.exposure === 'automation' || command.exposure === 'all';
}

/** Renders a compact boolean indicator for command metadata tables. */
function renderAvailabilityIndicator(value: boolean): string {
  return value ? '✅' : '❌';
}

const COMMAND_LIST_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '10px'
};

const INTRO_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  padding: '4px 2px 6px',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '16px'
};

const INTRO_LIST_STYLE: JSX.CSSProperties = {
  margin: 0,
  paddingLeft: '18px'
};

const COMMAND_TABLE_WRAPPER_STYLE: JSX.CSSProperties = {
  overflowX: 'auto',
  borderRadius: 'var(--button-corner-radius, 14px)',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.42))',
  background: 'var(--menu-background, #fff)',
  boxShadow: '0 8px 18px rgba(15, 23, 42, 0.055)'
};

const COMMAND_TABLE_STYLE: JSX.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '12px',
  lineHeight: '16px'
};

const COMMAND_HEADER_CELL_STYLE: JSX.CSSProperties = {
  padding: '9px 10px',
  borderBottom: '1px solid rgba(148, 163, 184, 0.24)',
  color: 'var(--button-icon-idle, rgb(71, 85, 105))',
  backgroundColor: 'rgba(248, 250, 252, 0.72)',
  fontSize: '10px',
  lineHeight: '13px',
  fontWeight: 800,
  letterSpacing: '0.04em',
  textAlign: 'left',
  textTransform: 'uppercase'
};

const COMMAND_CENTER_HEADER_CELL_STYLE: JSX.CSSProperties = {
  ...COMMAND_HEADER_CELL_STYLE,
  textAlign: 'center',
  whiteSpace: 'nowrap'
};

const COMMAND_CELL_STYLE: JSX.CSSProperties = {
  padding: '10px',
  borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
  verticalAlign: 'top'
};

const COMMAND_CENTER_CELL_STYLE: JSX.CSSProperties = {
  ...COMMAND_CELL_STYLE,
  width: '1%',
  textAlign: 'center',
  whiteSpace: 'nowrap'
};

const COMMAND_ID_STYLE: JSX.CSSProperties = {
  display: 'block',
  minWidth: 0,
  overflowWrap: 'anywhere',
  color: 'var(--button-icon-idle, rgb(71, 85, 105))',
  fontSize: '11px',
  lineHeight: '15px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
};

const COMMAND_LABEL_ID_STYLE: JSX.CSSProperties = {
  ...COMMAND_ID_STYLE,
  color: 'var(--menu-text, rgb(24, 24, 26))',
  fontSize: '13px',
  lineHeight: '17px'
};

const COMMAND_LABEL_STYLE: JSX.CSSProperties = {
  fontSize: '14px',
  lineHeight: '18px',
  fontWeight: 700
};

const COMMAND_DESCRIPTION_STYLE: JSX.CSSProperties = {
  color: 'var(--button-icon-idle, rgb(71, 85, 105))',
  fontSize: '12px',
  lineHeight: '16px'
};

const POSTMESSAGE_SECTION_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '10px 12px',
  borderRadius: 'var(--button-corner-radius, 14px)',
  border: '1px solid rgba(100, 116, 139, 0.18)',
  color: 'var(--button-icon-idle, rgb(71, 85, 105))',
  backgroundColor: 'rgba(248, 250, 252, 0.56)',
  fontSize: '12px',
  lineHeight: '16px'
};

const AUTOMATION_SUPPORT_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px'
};

const INLINE_CODE_STYLE: JSX.CSSProperties = {
  fontSize: '11px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
};

const COMMAND_EXAMPLE_STYLE: JSX.CSSProperties = {
  display: 'block',
  overflowX: 'auto',
  padding: '7px 8px',
  borderRadius: '8px',
  border: '1px solid rgba(100, 116, 139, 0.18)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  backgroundColor: 'rgba(255, 255, 255, 0.72)',
  fontSize: '11px',
  lineHeight: '15px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace'
};

const EMPTY_STATE_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '4px',
  padding: '12px',
  color: 'var(--button-icon-idle, rgb(71, 85, 105))',
  fontSize: '12px',
  lineHeight: '16px'
};
