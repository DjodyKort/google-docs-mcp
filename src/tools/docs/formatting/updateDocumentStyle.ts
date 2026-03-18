import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../../clients.js';
import { DocumentIdParameter, validateHexColor, hexToRgbColor } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'updateDocumentStyle',
    description:
      'Updates document-level styling: page margins, page size, background color, orientation, ' +
      'header/footer margins, and page number start. ' +
      'Margin changes clear section-level margin overrides.',
    parameters: DocumentIdParameter.extend({
      style: z
        .object({
          marginTop: z.number().min(0).optional().describe('Top page margin in points.'),
          marginBottom: z.number().min(0).optional().describe('Bottom page margin in points.'),
          marginLeft: z.number().min(0).optional().describe('Left page margin in points.'),
          marginRight: z.number().min(0).optional().describe('Right page margin in points.'),
          marginHeader: z
            .number()
            .min(0)
            .optional()
            .describe('Space between page top and header content in points.'),
          marginFooter: z
            .number()
            .min(0)
            .optional()
            .describe('Space between page bottom and footer content in points.'),
          pageWidth: z.number().min(1).optional().describe('Page width in points (e.g., 612 for US Letter).'),
          pageHeight: z
            .number()
            .min(1)
            .optional()
            .describe('Page height in points (e.g., 792 for US Letter).'),
          backgroundColor: z
            .string()
            .refine(validateHexColor, { message: 'Invalid hex color format' })
            .optional()
            .describe('Document background color as hex (e.g., "#FFFFFF").'),
          flipPageOrientation: z
            .boolean()
            .optional()
            .describe('Flip page orientation (swap portrait/landscape).'),
          pageNumberStart: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Starting page number.'),
          useFirstPageHeaderFooter: z
            .boolean()
            .optional()
            .describe('Use first-page-specific header/footer.'),
          useEvenPageHeaderFooter: z
            .boolean()
            .optional()
            .describe('Use even-page-specific header/footer.'),
        })
        .refine((s) => Object.values(s).some((v) => v !== undefined), {
          message: 'At least one document style option must be provided.',
        })
        .describe('The document styling to apply.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Updating document style for doc ${args.documentId}`);

      try {
        const documentStyle: Record<string, any> = {};
        const fieldsToUpdate: string[] = [];

        for (const margin of [
          'marginTop',
          'marginBottom',
          'marginLeft',
          'marginRight',
          'marginHeader',
          'marginFooter',
        ] as const) {
          if (args.style[margin] !== undefined) {
            documentStyle[margin] = { magnitude: args.style[margin], unit: 'PT' };
            fieldsToUpdate.push(margin);
          }
        }

        if (args.style.pageWidth !== undefined || args.style.pageHeight !== undefined) {
          documentStyle.pageSize = {};
          if (args.style.pageWidth !== undefined) {
            documentStyle.pageSize.width = { magnitude: args.style.pageWidth, unit: 'PT' };
          }
          if (args.style.pageHeight !== undefined) {
            documentStyle.pageSize.height = { magnitude: args.style.pageHeight, unit: 'PT' };
          }
          fieldsToUpdate.push('pageSize');
        }

        if (args.style.backgroundColor !== undefined) {
          const rgbColor = hexToRgbColor(args.style.backgroundColor);
          if (!rgbColor)
            throw new UserError(`Invalid background hex color: ${args.style.backgroundColor}`);
          documentStyle.background = { color: { color: { rgbColor } } };
          fieldsToUpdate.push('background');
        }

        if (args.style.flipPageOrientation !== undefined) {
          documentStyle.flipPageOrientation = args.style.flipPageOrientation;
          fieldsToUpdate.push('flipPageOrientation');
        }

        if (args.style.pageNumberStart !== undefined) {
          documentStyle.pageNumberStart = args.style.pageNumberStart;
          fieldsToUpdate.push('pageNumberStart');
        }

        if (args.style.useFirstPageHeaderFooter !== undefined) {
          documentStyle.useFirstPageHeaderFooter = args.style.useFirstPageHeaderFooter;
          fieldsToUpdate.push('useFirstPageHeaderFooter');
        }

        if (args.style.useEvenPageHeaderFooter !== undefined) {
          documentStyle.useEvenPageHeaderFooter = args.style.useEvenPageHeaderFooter;
          fieldsToUpdate.push('useEvenPageHeaderFooter');
        }

        if (fieldsToUpdate.length === 0) {
          return 'No valid document style options were provided.';
        }

        const request: any = {
          updateDocumentStyle: {
            documentStyle,
            fields: fieldsToUpdate.join(','),
            ...(args.tabId && { tabId: args.tabId }),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully updated document style (${fieldsToUpdate.join(', ')}) for doc ${args.documentId}.`;
      } catch (error: any) {
        log.error(`Error updating document style: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to update document style: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
