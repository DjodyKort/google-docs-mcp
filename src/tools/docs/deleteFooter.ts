import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'deleteFooter',
    description:
      'Deletes a footer from the document. The footer content is removed and the space is reclaimed. ' +
      "Use readGoogleDoc with format='json' to find footer IDs (defaultFooterId, firstPageFooterId, etc.).",
    parameters: DocumentIdParameter.extend({
      footerId: z
        .string()
        .describe('The ID of the footer to delete (e.g., "kd.xyz789").'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Deleting footer ${args.footerId} from doc ${args.documentId}`);

      try {
        const request: any = {
          deleteFooter: {
            footerId: args.footerId,
            ...(args.tabId && { tabId: args.tabId }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully deleted footer ${args.footerId}.`;
      } catch (error: any) {
        log.error(`Error deleting footer: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete footer: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
