import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'pinTableHeaderRows',
    description:
      'Pins (or unpins) header rows in a table so they repeat on each page when the table spans ' +
      'multiple pages. Set pinnedHeaderRowsCount to 0 to unpin all headers. ' +
      "Use readGoogleDoc with format='json' to find the table's startIndex.",
    parameters: DocumentIdParameter.extend({
      tableStartIndex: z
        .number()
        .int()
        .min(0)
        .describe('The startIndex of the table element in the document body.'),
      pinnedHeaderRowsCount: z
        .number()
        .int()
        .min(0)
        .describe(
          'Number of rows from the top to pin as headers (0 to unpin all). ' +
            'These rows will repeat at the top of each page when the table breaks across pages.'
        ),
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
        `Pinning ${args.pinnedHeaderRowsCount} header rows in table at index ${args.tableStartIndex} ` +
          `in doc ${args.documentId}`
      );

      try {
        const tableStartLocation: any = { index: args.tableStartIndex };
        if (args.tabId) tableStartLocation.tabId = args.tabId;

        const request: any = {
          pinTableHeaderRows: {
            tableStartLocation,
            pinnedHeaderRowsCount: args.pinnedHeaderRowsCount,
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return args.pinnedHeaderRowsCount > 0
          ? `Successfully pinned ${args.pinnedHeaderRowsCount} header row(s) in table at index ${args.tableStartIndex}.`
          : `Successfully unpinned all header rows in table at index ${args.tableStartIndex}.`;
      } catch (error: any) {
        log.error(`Error pinning table header rows: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to pin table header rows: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
