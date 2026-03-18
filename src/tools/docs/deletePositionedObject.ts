import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'deletePositionedObject',
    description:
      'Deletes a positioned (floating) object from the document, such as a floating image or text box. ' +
      "Use readGoogleDoc with format='json' to find positioned object IDs.",
    parameters: DocumentIdParameter.extend({
      objectId: z
        .string()
        .describe('The ID of the positioned object to delete.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Deleting positioned object ${args.objectId} from doc ${args.documentId}`);

      try {
        const request: any = {
          deletePositionedObject: {
            objectId: args.objectId,
            ...(args.tabId && { tabId: args.tabId }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully deleted positioned object ${args.objectId}.`;
      } catch (error: any) {
        log.error(`Error deleting positioned object: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to delete positioned object: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
