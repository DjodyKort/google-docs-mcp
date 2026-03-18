import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../../clients.js';
import { DocumentIdParameter } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'deleteParagraphBullets',
    description:
      'Removes bullet or numbered list formatting from paragraphs within a range. ' +
      'The text content is preserved but list formatting (indentation, glyphs) is removed.',
    parameters: DocumentIdParameter.extend({
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
        `Deleting paragraph bullets in doc ${args.documentId} for range ${args.startIndex}-${args.endIndex}`
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
          deleteParagraphBullets: { range },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return (
          `Successfully removed bullets from range ${args.startIndex}-${args.endIndex}` +
          `${args.tabId ? ` in tab ${args.tabId}` : ''}.`
        );
      } catch (error: any) {
        log.error(`Error deleting paragraph bullets: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to delete paragraph bullets: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
