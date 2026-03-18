import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'insertTableColumn',
    description:
      'Inserts a new empty column into a table. The new column is inserted to the left or right ' +
      'of the column at the specified cell location. ' +
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
        .describe('Row index of the reference cell (0-based).'),
      columnIndex: z
        .number()
        .int()
        .min(0)
        .describe('Column index of the reference cell (0-based).'),
      insertRight: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'If true (default), insert to the right of the reference column. If false, insert to the left.'
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
        `Inserting table column ${args.insertRight ? 'right of' : 'left of'} column ${args.columnIndex} ` +
          `in table at index ${args.tableStartIndex}`
      );

      try {
        const tableStartLocation: any = { index: args.tableStartIndex };
        if (args.tabId) tableStartLocation.tabId = args.tabId;

        const request: any = {
          insertTableColumn: {
            tableCellLocation: {
              tableStartLocation,
              rowIndex: args.rowIndex,
              columnIndex: args.columnIndex,
            },
            insertRight: args.insertRight ?? true,
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return (
          `Successfully inserted column ${args.insertRight ? 'right of' : 'left of'} ` +
          `column ${args.columnIndex} in table at index ${args.tableStartIndex}.`
        );
      } catch (error: any) {
        log.error(`Error inserting table column: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to insert table column: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
