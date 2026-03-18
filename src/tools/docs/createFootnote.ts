import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'createFootnote',
    description:
      'Creates a footnote reference at a specific index in the document. ' +
      'Returns the footnote ID which can be used to insert content into the footnote ' +
      'via insertText (using the footnote ID as segmentId).',
    parameters: DocumentIdParameter.extend({
      index: z
        .number()
        .int()
        .min(1)
        .describe('1-based character index where the footnote reference should be inserted.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Creating footnote at index ${args.index} in doc ${args.documentId}`);

      try {
        const location: any = { index: args.index };
        if (args.tabId) location.tabId = args.tabId;

        const request: any = {
          createFootnote: {
            location,
          },
        };

        const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        const footnoteId = (response.replies as any)?.[0]?.createFootnote?.footnoteId;

        return (
          `Successfully created footnote at index ${args.index}` +
          (footnoteId ? ` (ID: ${footnoteId})` : '') +
          `${args.tabId ? ` in tab ${args.tabId}` : ''}` +
          `. Use insertText with segmentId="${footnoteId}" to add content.`
        );
      } catch (error: any) {
        log.error(`Error creating footnote: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create footnote: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
