import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../../clients.js';
import { DocumentIdParameter } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'formatTableRows',
    description:
      'Updates row-level properties of a table: minimum row height, whether a row is a table header, ' +
      'and whether rows can overflow to the next page. ' +
      "Use readGoogleDoc with format='json' to find the table's startIndex.",
    parameters: DocumentIdParameter.extend({
      tableStartIndex: z
        .number()
        .int()
        .min(0)
        .describe('The startIndex of the table element in the document body.'),
      rowIndices: z
        .array(z.number().int().min(0))
        .optional()
        .describe('0-based row indices to update. If omitted, updates all rows.'),
      style: z
        .object({
          minRowHeight: z
            .number()
            .min(0)
            .optional()
            .describe('Minimum row height in points. The row may render taller to fit content.'),
          tableHeader: z
            .boolean()
            .optional()
            .describe('Whether the row is a table header (repeats on each page).'),
          preventOverflow: z
            .boolean()
            .optional()
            .describe('Whether to prevent the row from overflowing to the next page.'),
        })
        .refine((s) => Object.values(s).some((v) => v !== undefined), {
          message: 'At least one row style option must be provided.',
        })
        .describe('The row styling to apply.'),
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
        `Formatting table rows in doc ${args.documentId} at table index ${args.tableStartIndex}` +
          (args.rowIndices ? ` (rows: ${args.rowIndices.join(', ')})` : ' (all rows)')
      );

      try {
        const tableRowStyle: Record<string, any> = {};
        const fieldsToUpdate: string[] = [];

        if (args.style.minRowHeight !== undefined) {
          tableRowStyle.minRowHeight = { magnitude: args.style.minRowHeight, unit: 'PT' };
          fieldsToUpdate.push('minRowHeight');
        }
        if (args.style.tableHeader !== undefined) {
          tableRowStyle.tableHeader = args.style.tableHeader;
          fieldsToUpdate.push('tableHeader');
        }
        if (args.style.preventOverflow !== undefined) {
          tableRowStyle.preventOverflow = args.style.preventOverflow;
          fieldsToUpdate.push('preventOverflow');
        }

        if (fieldsToUpdate.length === 0) {
          return 'No valid row styling options were provided.';
        }

        const tableStartLocation: any = { index: args.tableStartIndex };
        if (args.tabId) tableStartLocation.tabId = args.tabId;

        const request: any = {
          updateTableRowStyle: {
            tableStartLocation,
            tableRowStyle,
            fields: fieldsToUpdate.join(','),
            ...(args.rowIndices && { rowIndices: args.rowIndices }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return (
          `Successfully applied row style (${fieldsToUpdate.join(', ')}) ` +
          (args.rowIndices ? `to rows [${args.rowIndices.join(', ')}]` : 'to all rows') +
          ` in table at index ${args.tableStartIndex}.`
        );
      } catch (error: any) {
        log.error(`Error formatting table rows: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to format table rows: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
