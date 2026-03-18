import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'replaceImage',
    description:
      'Replaces an existing inline image in the document with a new image from a URL. ' +
      'The new image retains the size and position of the original. ' +
      "Use readGoogleDoc with format='json' to find the image's objectId " +
      '(look for inlineObjectElement.inlineObjectId in the document structure).',
    parameters: DocumentIdParameter.extend({
      imageObjectId: z
        .string()
        .describe(
          'The object ID of the inline image to replace (e.g., "kix.abc123"). ' +
            "Found in the document JSON as inlineObjectElement.inlineObjectId."
        ),
      uri: z
        .string()
        .url()
        .describe('The publicly accessible URL of the new image.'),
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
        `Replacing image ${args.imageObjectId} in doc ${args.documentId} with ${args.uri}`
      );

      try {
        const request: any = {
          replaceImage: {
            imageObjectId: args.imageObjectId,
            uri: args.uri,
            ...(args.tabId && { tabId: args.tabId }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully replaced image ${args.imageObjectId} with new image from URL.`;
      } catch (error: any) {
        log.error(`Error replacing image: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to replace image: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
