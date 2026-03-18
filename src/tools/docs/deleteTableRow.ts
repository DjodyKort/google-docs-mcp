import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'deleteTableRow',
    description:
      'Deletes a row from a table. The row containing the specified cell is removed. ' +
      "Use readGoogleDoc with format='json' to find the table's startIndex.",
    parameters: DocumentIdParameter.extend({
      tableStartIndex: z
        .number()
        .int()
        .min(0)
        .describe('The startIndex of the table element in the document body.'),
      rowIndex: z
        .number()
        .int()
        .min(0)
        .describe('Row index of a cell in the row to delete (0-based).'),
      columnIndex: z
        .number()
        .int()
        .min(0)
        .describe('Column index of a cell in the row to delete (0-based).'),
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
        `Deleting row ${args.rowIndex} from table at index ${args.tableStartIndex} ` +
          `in doc ${args.documentId}`
      );

      try {
        const tableStartLocation: any = { index: args.tableStartIndex };
        if (args.tabId) tableStartLocation.tabId = args.tabId;

        const request: any = {
          deleteTableRow: {
            tableCellLocation: {
              tableStartLocation,
              rowIndex: args.rowIndex,
              columnIndex: args.columnIndex,
            },
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully deleted row ${args.rowIndex} from table at index ${args.tableStartIndex}.`;
      } catch (error: any) {
        log.error(`Error deleting table row: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete table row: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
