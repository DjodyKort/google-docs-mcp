import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'deleteHeader',
    description:
      'Deletes a header from the document. The header content is removed and the space is reclaimed. ' +
      "Use readGoogleDoc with format='json' to find header IDs (defaultHeaderId, firstPageHeaderId, etc.).",
    parameters: DocumentIdParameter.extend({
      headerId: z
        .string()
        .describe('The ID of the header to delete (e.g., "kd.abc123").'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Deleting header ${args.headerId} from doc ${args.documentId}`);

      try {
        const request: any = {
          deleteHeader: {
            headerId: args.headerId,
            ...(args.tabId && { tabId: args.tabId }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully deleted header ${args.headerId}.`;
      } catch (error: any) {
        log.error(`Error deleting header: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete header: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
