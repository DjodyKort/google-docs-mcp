import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'findText',
    description:
      'Find text in a Google Doc and return its character indices (startIndex, endIndex). Useful for locating text before using insertText or deleteRange. Returns all occurrences by default, or a specific instance.',
    parameters: DocumentIdParameter.extend({
      searchText: z
        .string()
        .min(1)
        .describe('The text to search for in the document.'),
      instance: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          'Which occurrence to return (1 = first, 2 = second, etc.). If omitted, returns all occurrences.'
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to search in. If not specified, searches the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Finding "${args.searchText}" in doc ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      try {
        if (args.instance) {
          const result = await GDocsHelpers.findTextRange(
            docs,
            args.documentId,
            args.searchText,
            args.instance,
            args.tabId
          );

          if (!result) {
            return `Text "${args.searchText}" not found (instance ${args.instance}).`;
          }

          return JSON.stringify({
            found: true,
            instance: args.instance,
            startIndex: result.startIndex,
            endIndex: result.endIndex,
            text: args.searchText,
          });
        }

        // Find all occurrences by iterating
        const occurrences: Array<{
          instance: number;
          startIndex: number;
          endIndex: number;
        }> = [];
        let i = 1;

        while (true) {
          const result = await GDocsHelpers.findTextRange(
            docs,
            args.documentId,
            args.searchText,
            i,
            args.tabId
          );

          if (!result) break;

          occurrences.push({
            instance: i,
            startIndex: result.startIndex,
            endIndex: result.endIndex,
          });
          i++;

          // Safety limit
          if (i > 500) {
            log.info(`Reached 500 occurrences limit for "${args.searchText}"`);
            break;
          }
        }

        if (occurrences.length === 0) {
          return `Text "${args.searchText}" not found in document.`;
        }

        return JSON.stringify({
          found: true,
          text: args.searchText,
          totalOccurrences: occurrences.length,
          occurrences,
        });
      } catch (error: any) {
        log.error(
          `Error finding text in doc ${args.documentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to find text: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
