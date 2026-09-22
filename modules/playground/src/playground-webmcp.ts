// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {z} from 'zod';
import type {Playground} from './playground';

/** Explicit capabilities exposed through the experimental WebMCP browser API. */
export type PlaygroundWebMCPOptions = {
  /** Existing, trusted template IDs to expose (1–32 IDs, each at most 32 characters). */
  templates: readonly string[];
  /** Unique tool-name prefix within the document. Defaults to `playground`. */
  name?: string;
};

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {readOnlyHint: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean};
  // Some browser previews omit execution options.
  execute: (input: unknown, options?: {signal?: AbortSignal}) => Promise<unknown>;
};

// Keep the experimental browser contract local; do not augment global DOM types.
type ModelContext = {
  registerTool: (tool: Tool, options: {signal: AbortSignal}) => Promise<void>;
};
type ToolTarget = Pick<Playground, 'parentElement' | 'setTemplate'> & {resetView?: () => void};

// Assert absolute end: `$` would also accept a trailing line terminator.
const OPTIONS_SCHEMA = z.strictObject({
  templates: z
    .array(
      z
        .string()
        .max(32)
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*(?![\s\S])/)
    )
    .min(1)
    .max(32),
  name: z
    .string()
    .max(48)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*(?![\s\S])/)
    .default('playground')
});
const EMPTY_INPUT = z.strictObject({});

/** Registers only owned tools, rolling back registration failures without clearing page context. */
export async function registerPlaygroundTools(
  playground: ToolTarget,
  options: PlaygroundWebMCPOptions,
  lifetime: AbortSignal
): Promise<(() => void) | null> {
  const {name, templates} = OPTIONS_SCHEMA.parse({...options});
  const document = playground.parentElement.ownerDocument as Document & {
    modelContext?: ModelContext;
  };
  const context = document.modelContext;
  if (!context?.registerTool) return null;

  const controller = new AbortController();
  const signal = AbortSignal.any([lifetime, controller.signal]);
  let active = false;
  const selectInput = z.strictObject({template: z.enum(templates)});
  function execute<T>(schema: z.ZodType<T>, action: (input: T) => unknown): Tool['execute'] {
    return async (input, execution) => {
      if (!active || signal.aborted || execution?.signal?.aborted) {
        throw new Error('Playground tools are unavailable');
      }
      // Read only own fields, including when called directly by same-origin scripts.
      const record =
        input && typeof input === 'object' && !Array.isArray(input) ? {...input} : input;
      const parsed = schema.safeParse(record);
      if (!parsed.success) throw new Error('Invalid Playground tool input');
      try {
        return action(parsed.data);
      } catch {
        // Host errors may contain source URLs or rows; never return them to the caller.
        throw new Error('Playground action failed');
      }
    };
  }

  const tools: Tool[] = [
    {
      name: `${name}.list_templates`,
      description: 'List the template IDs explicitly exposed by this playground.',
      inputSchema: z.toJSONSchema(EMPTY_INPUT),
      annotations: {readOnlyHint: true, untrustedContentHint: true},
      execute: execute(EMPTY_INPUT, () => ({templates: [...templates]}))
    },
    {
      name: `${name}.select_template`,
      description:
        'Replace the editor text with an approved template and request its preview. ' +
        'This discards current edits and invokes the application renderer and callbacks.',
      inputSchema: z.toJSONSchema(selectInput),
      annotations: {readOnlyHint: false, consequentialHint: true},
      execute: execute(selectInput, ({template}) => {
        playground.setTemplate(template);
        return {status: 'requested'};
      })
    }
  ];
  if (playground.resetView) {
    tools.push({
      name: `${name}.reset_view`,
      description: 'Reset the preview camera to the accepted document’s initial view.',
      inputSchema: z.toJSONSchema(EMPTY_INPUT),
      annotations: {readOnlyHint: false},
      execute: execute(EMPTY_INPUT, () => {
        playground.resetView!();
        return {status: 'requested'};
      })
    });
  }
  try {
    for (const tool of tools) await context.registerTool(tool, {signal});
    signal.throwIfAborted();
    active = true;
    return () => controller.abort();
  } catch (error) {
    controller.abort();
    throw error;
  }
}
