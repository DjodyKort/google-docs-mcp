import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../../clients.js';
import { DocumentIdParameter, TableCellStyleParameters } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'formatTableCells',
    description:
      'Applies cell-level formatting (background color, borders, padding, vertical alignment) to table cells. ' +
      'Target all cells in a table, or a specific rectangular range of cells. ' +
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
        .optional()
        .describe(
          'Starting row index (0-based). If omitted along with columnIndex, styles all cells in the table.'
        ),
      columnIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'Starting column index (0-based). If omitted along with rowIndex, styles all cells in the table.'
        ),
      rowSpan: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe('Number of rows to style (default 1). Only used when rowIndex/columnIndex are set.'),
      columnSpan: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe('Number of columns to style (default 1). Only used when rowIndex/columnIndex are set.'),
      style: TableCellStyleParameters.refine(
        (s) => Object.values(s).some((v) => v !== undefined),
        { message: 'At least one cell style option must be provided.' }
      ).describe('The cell styling to apply.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. Use listDocumentTabs to get tab IDs. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      const hasRange = args.rowIndex !== undefined && args.columnIndex !== undefined;

      log.info(
        `Formatting table cells in doc ${args.documentId} at table index ${args.tableStartIndex}` +
          (hasRange
            ? ` (rows ${args.rowIndex}-${args.rowIndex! + (args.rowSpan ?? 1) - 1}, cols ${args.columnIndex}-${args.columnIndex! + (args.columnSpan ?? 1) - 1})`
            : ' (all cells)') +
          `${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      try {
        const cellRange = hasRange
          ? {
              rowIndex: args.rowIndex!,
              columnIndex: args.columnIndex!,
              rowSpan: args.rowSpan ?? 1,
              columnSpan: args.columnSpan ?? 1,
            }
          : undefined;

        const requestInfo = GDocsHelpers.buildUpdateTableCellStyleRequest(
          args.tableStartIndex,
          args.style,
          cellRange,
          args.tabId
        );

        if (!requestInfo) {
          return 'No valid cell styling options were provided.';
        }

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [requestInfo.request]);

        return (
          `Successfully applied table cell style (${requestInfo.fields.join(', ')}) ` +
          (hasRange
            ? `to cells [${args.rowIndex},${args.columnIndex}] span ${args.rowSpan}x${args.columnSpan}`
            : 'to all cells') +
          ` in table at index ${args.tableStartIndex}` +
          `${args.tabId ? ` (tab: ${args.tabId})` : ''}.`
        );
      } catch (error: any) {
        log.error(`Error formatting table cells: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to format table cells: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
