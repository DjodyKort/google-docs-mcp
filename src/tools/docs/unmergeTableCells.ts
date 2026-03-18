import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'unmergeTableCells',
    description:
      'Unmerges previously merged cells in a table. The range must exactly match ' +
      'a previously merged region. Content stays in the top-left cell; other cells become empty. ' +
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
        .describe('Row index of the top-left cell of the merged range (0-based).'),
      columnIndex: z
        .number()
        .int()
        .min(0)
        .describe('Column index of the top-left cell of the merged range (0-based).'),
      rowSpan: z
        .number()
        .int()
        .min(1)
        .describe('Number of rows in the merged range.'),
      columnSpan: z
        .number()
        .int()
        .min(1)
        .describe('Number of columns in the merged range.'),
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
        `Unmerging table cells in doc ${args.documentId} at table index ${args.tableStartIndex}: ` +
          `[${args.rowIndex},${args.columnIndex}] span ${args.rowSpan}x${args.columnSpan}`
      );

      try {
        const tableStartLocation: any = { index: args.tableStartIndex };
        if (args.tabId) tableStartLocation.tabId = args.tabId;

        const request: any = {
          unmergeTableCells: {
            tableRange: {
              tableCellLocation: {
                tableStartLocation,
                rowIndex: args.rowIndex,
                columnIndex: args.columnIndex,
              },
              rowSpan: args.rowSpan,
              columnSpan: args.columnSpan,
            },
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return (
          `Successfully unmerged cells [${args.rowIndex},${args.columnIndex}] ` +
          `span ${args.rowSpan}x${args.columnSpan} in table at index ${args.tableStartIndex}.`
        );
      } catch (error: any) {
        log.error(`Error unmerging table cells: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to unmerge table cells: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
