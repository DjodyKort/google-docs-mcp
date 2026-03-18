import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../../clients.js';
import { DocumentIdParameter } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'formatTableColumns',
    description:
      'Updates column properties of a table (width, width type). ' +
      'Column width must be at least 5 points. ' +
      "Use readGoogleDoc with format='json' to find the table's startIndex.",
    parameters: DocumentIdParameter.extend({
      tableStartIndex: z
        .number()
        .int()
        .min(0)
        .describe('The startIndex of the table element in the document body.'),
      columnIndices: z
        .array(z.number().int().min(0))
        .optional()
        .describe('0-based column indices to update. If omitted, updates all columns.'),
      style: z
        .object({
          width: z
            .number()
            .min(5)
            .optional()
            .describe('Column width in points (minimum 5).'),
          widthType: z
            .enum(['EVENLY_DISTRIBUTED', 'FIXED_WIDTH'])
            .optional()
            .describe(
              'How width is calculated. EVENLY_DISTRIBUTED: auto-calculated equal portions. FIXED_WIDTH: uses the width value.'
            ),
        })
        .refine((s) => Object.values(s).some((v) => v !== undefined), {
          message: 'At least one column property must be provided.',
        })
        .describe('The column properties to apply.'),
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
        `Formatting table columns in doc ${args.documentId} at table index ${args.tableStartIndex}` +
          (args.columnIndices ? ` (columns: ${args.columnIndices.join(', ')})` : ' (all columns)')
      );

      try {
        const tableColumnProperties: Record<string, any> = {};
        const fieldsToUpdate: string[] = [];

        if (args.style.width !== undefined) {
          tableColumnProperties.width = { magnitude: args.style.width, unit: 'PT' };
          fieldsToUpdate.push('width');
        }
        if (args.style.widthType !== undefined) {
          tableColumnProperties.widthType = args.style.widthType;
          fieldsToUpdate.push('widthType');
        }

        if (fieldsToUpdate.length === 0) {
          return 'No valid column properties were provided.';
        }

        const tableStartLocation: any = { index: args.tableStartIndex };
        if (args.tabId) tableStartLocation.tabId = args.tabId;

        const request: any = {
          updateTableColumnProperties: {
            tableStartLocation,
            tableColumnProperties,
            fields: fieldsToUpdate.join(','),
            ...(args.columnIndices && { columnIndices: args.columnIndices }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return (
          `Successfully applied column properties (${fieldsToUpdate.join(', ')}) ` +
          (args.columnIndices
            ? `to columns [${args.columnIndices.join(', ')}]`
            : 'to all columns') +
          ` in table at index ${args.tableStartIndex}.`
        );
      } catch (error: any) {
        log.error(`Error formatting table columns: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to format table columns: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
