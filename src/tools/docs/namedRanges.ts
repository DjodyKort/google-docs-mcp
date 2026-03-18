import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function registerCreateNamedRange(server: FastMCP) {
  server.addTool({
    name: 'createNamedRange',
    description:
      'Creates a named range in the document. Named ranges are bookmarks that label a range of content, ' +
      'useful for template placeholders that can be targeted by replaceNamedRangeContent.',
    parameters: DocumentIdParameter.extend({
      name: z
        .string()
        .min(1)
        .describe('The name for the range. Multiple ranges can share the same name.'),
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe('Start of the range (1-based, inclusive).'),
      endIndex: z
        .number()
        .int()
        .min(1)
        .describe('End of the range (1-based, exclusive).'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(
        `Creating named range "${args.name}" at ${args.startIndex}-${args.endIndex} in doc ${args.documentId}`
      );

      try {
        if (args.endIndex <= args.startIndex) {
          throw new UserError('endIndex must be greater than startIndex.');
        }

        const range: any = {
          startIndex: args.startIndex,
          endIndex: args.endIndex,
        };
        if (args.tabId) range.tabId = args.tabId;

        const request: any = {
          createNamedRange: {
            name: args.name,
            range,
          },
        };

        const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        const namedRangeId = (response.replies as any)?.[0]?.createNamedRange?.namedRangeId;

        return (
          `Successfully created named range "${args.name}"` +
          (namedRangeId ? ` (ID: ${namedRangeId})` : '') +
          ` at range ${args.startIndex}-${args.endIndex}.`
        );
      } catch (error: any) {
        log.error(`Error creating named range: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create named range: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

export function registerDeleteNamedRange(server: FastMCP) {
  server.addTool({
    name: 'deleteNamedRange',
    description:
      'Deletes a named range from the document. The content within the range is preserved; ' +
      'only the named range label is removed. Target by name (deletes all ranges with that name) or by ID.',
    parameters: DocumentIdParameter.extend({
      name: z
        .string()
        .optional()
        .describe('Delete all named ranges with this name. Provide either name or namedRangeId.'),
      namedRangeId: z
        .string()
        .optional()
        .describe('Delete a specific named range by ID. Provide either name or namedRangeId.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      if (!args.name && !args.namedRangeId) {
        throw new UserError('Provide either name or namedRangeId to identify which named range to delete.');
      }

      log.info(
        `Deleting named range ${args.name ? `"${args.name}"` : `ID ${args.namedRangeId}`} from doc ${args.documentId}`
      );

      try {
        const request: any = {
          deleteNamedRange: {
            ...(args.name && { name: args.name }),
            ...(args.namedRangeId && { namedRangeId: args.namedRangeId }),
            ...(args.tabId && { tabId: args.tabId }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully deleted named range ${args.name ? `"${args.name}"` : `ID ${args.namedRangeId}`}.`;
      } catch (error: any) {
        log.error(`Error deleting named range: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete named range: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

export function registerReplaceNamedRangeContent(server: FastMCP) {
  server.addTool({
    name: 'replaceNamedRangeContent',
    description:
      'Replaces the content of all instances of a named range with new text. ' +
      'Useful for template workflows: create named ranges as placeholders, then replace their content. ' +
      'Target by name (replaces all ranges with that name) or by ID.',
    parameters: DocumentIdParameter.extend({
      name: z
        .string()
        .optional()
        .describe('Replace content in all named ranges with this name. Provide either name or namedRangeId.'),
      namedRangeId: z
        .string()
        .optional()
        .describe('Replace content in a specific named range by ID. Provide either name or namedRangeId.'),
      text: z.string().describe('The replacement text.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      if (!args.name && !args.namedRangeId) {
        throw new UserError('Provide either name or namedRangeId to identify which named range to replace.');
      }

      log.info(
        `Replacing named range content ${args.name ? `"${args.name}"` : `ID ${args.namedRangeId}`} in doc ${args.documentId}`
      );

      try {
        const request: any = {
          replaceNamedRangeContent: {
            ...(args.name && { name: args.name }),
            ...(args.namedRangeId && { namedRangeId: args.namedRangeId }),
            text: args.text,
            ...(args.tabId && { tabId: args.tabId }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return (
          `Successfully replaced content in named range ` +
          `${args.name ? `"${args.name}"` : `ID ${args.namedRangeId}`} ` +
          `with "${args.text.length > 50 ? args.text.slice(0, 50) + '...' : args.text}".`
        );
      } catch (error: any) {
        log.error(`Error replacing named range content: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to replace named range content: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
