import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'createFooter',
    description:
      'Creates a footer in the document. Returns the footer ID which can be used to insert ' +
      'content into the footer via insertText (using the footer ID as segmentId). ' +
      'Use type DEFAULT for the standard footer, FIRST_PAGE for a different first-page footer.',
    parameters: DocumentIdParameter.extend({
      type: z
        .enum(['DEFAULT', 'FIRST_PAGE'])
        .describe(
          'DEFAULT: standard footer for all pages (or non-first pages if first-page footer is enabled). ' +
            'FIRST_PAGE: footer only on the first page.'
        ),
      sectionBreakIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'The index of the section break whose section gets the footer. ' +
            'If omitted, applies to the first section (document-level footer). ' +
            "Use readGoogleDoc with format='json' to find section break indices."
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
        `Creating ${args.type} footer in doc ${args.documentId}` +
          (args.sectionBreakIndex !== undefined
            ? ` at section break index ${args.sectionBreakIndex}`
            : ' (document level)')
      );

      try {
        const request: any = {
          createFooter: {
            type: args.type,
            ...(args.sectionBreakIndex !== undefined && {
              sectionBreakLocation: {
                index: args.sectionBreakIndex,
                ...(args.tabId && { tabId: args.tabId }),
              },
            }),
          },
        };

        const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        const footerId = (response.replies as any)?.[0]?.createFooter?.footerId;

        return (
          `Successfully created ${args.type} footer` +
          (footerId ? ` (ID: ${footerId})` : '') +
          `. Use insertText with segmentId="${footerId}" to add content to the footer.`
        );
      } catch (error: any) {
        log.error(`Error creating footer: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create footer: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
