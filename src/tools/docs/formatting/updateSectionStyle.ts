import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../../clients.js';
import { DocumentIdParameter } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'updateSectionStyle',
    description:
      'Updates section-level styling: column count, column properties, content direction, ' +
      'section margins, and page orientation. Sections are delimited by section breaks. ' +
      'Provide a character range that falls within the target section.',
    parameters: DocumentIdParameter.extend({
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe('Start of the range within the target section (1-based, inclusive).'),
      endIndex: z
        .number()
        .int()
        .min(1)
        .describe('End of the range within the target section (1-based, exclusive).'),
      style: z
        .object({
          columnCount: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('Number of columns in the section.'),
          columnSeparatorStyle: z
            .enum(['NONE', 'BETWEEN_EACH_COLUMN'])
            .optional()
            .describe('Whether to show separator lines between columns.'),
          contentDirection: z
            .enum(['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT'])
            .optional()
            .describe('Content direction for the section.'),
          marginTop: z.number().min(0).optional().describe('Section top margin in points.'),
          marginBottom: z.number().min(0).optional().describe('Section bottom margin in points.'),
          marginLeft: z.number().min(0).optional().describe('Section left margin in points.'),
          marginRight: z.number().min(0).optional().describe('Section right margin in points.'),
          marginHeader: z.number().min(0).optional().describe('Section header margin in points.'),
          marginFooter: z.number().min(0).optional().describe('Section footer margin in points.'),
          flipPageOrientation: z
            .boolean()
            .optional()
            .describe('Flip page orientation for this section.'),
          pageNumberStart: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Section-specific page numbering start.'),
          useFirstPageHeaderFooter: z
            .boolean()
            .optional()
            .describe('Use first-page header/footer for this section.'),
        })
        .refine((s) => Object.values(s).some((v) => v !== undefined), {
          message: 'At least one section style option must be provided.',
        })
        .describe('The section styling to apply.'),
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
        `Updating section style in doc ${args.documentId} for range ${args.startIndex}-${args.endIndex}`
      );

      try {
        const sectionStyle: Record<string, any> = {};
        const fieldsToUpdate: string[] = [];

        if (args.style.columnCount !== undefined) {
          sectionStyle.columnCount = args.style.columnCount;
          fieldsToUpdate.push('columnCount');
        }

        if (args.style.columnSeparatorStyle !== undefined) {
          sectionStyle.columnSeparatorStyle = args.style.columnSeparatorStyle;
          fieldsToUpdate.push('columnSeparatorStyle');
        }

        if (args.style.contentDirection !== undefined) {
          sectionStyle.contentDirection = args.style.contentDirection;
          fieldsToUpdate.push('contentDirection');
        }

        for (const margin of [
          'marginTop',
          'marginBottom',
          'marginLeft',
          'marginRight',
          'marginHeader',
          'marginFooter',
        ] as const) {
          if (args.style[margin] !== undefined) {
            sectionStyle[margin] = { magnitude: args.style[margin], unit: 'PT' };
            fieldsToUpdate.push(margin);
          }
        }

        if (args.style.flipPageOrientation !== undefined) {
          sectionStyle.flipPageOrientation = args.style.flipPageOrientation;
          fieldsToUpdate.push('flipPageOrientation');
        }

        if (args.style.pageNumberStart !== undefined) {
          sectionStyle.pageNumberStart = args.style.pageNumberStart;
          fieldsToUpdate.push('pageNumberStart');
        }

        if (args.style.useFirstPageHeaderFooter !== undefined) {
          sectionStyle.useFirstPageHeaderFooter = args.style.useFirstPageHeaderFooter;
          fieldsToUpdate.push('useFirstPageHeaderFooter');
        }

        if (fieldsToUpdate.length === 0) {
          return 'No valid section style options were provided.';
        }

        const range: any = {
          startIndex: args.startIndex,
          endIndex: args.endIndex,
        };
        if (args.tabId) range.tabId = args.tabId;

        const request: any = {
          updateSectionStyle: {
            range,
            sectionStyle,
            fields: fieldsToUpdate.join(','),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully updated section style (${fieldsToUpdate.join(', ')}) for range ${args.startIndex}-${args.endIndex}.`;
      } catch (error: any) {
        log.error(`Error updating section style: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to update section style: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
