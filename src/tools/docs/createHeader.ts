import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'createHeader',
    description:
      'Creates a header in the document. Returns the header ID which can be used to insert ' +
      'content into the header via insertText (using the header ID as segmentId). ' +
      'Use type DEFAULT for the standard header, FIRST_PAGE for a different first-page header.',
    parameters: DocumentIdParameter.extend({
      type: z
        .enum(['DEFAULT', 'FIRST_PAGE'])
        .describe(
          'DEFAULT: standard header for all pages (or non-first pages if first-page header is enabled). ' +
            'FIRST_PAGE: header only on the first page.'
        ),
      sectionBreakIndex: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(
          'The index of the section break whose section gets the header. ' +
            'If omitted, applies to the first section (document-level header). ' +
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
        `Creating ${args.type} header in doc ${args.documentId}` +
          (args.sectionBreakIndex !== undefined
            ? ` at section break index ${args.sectionBreakIndex}`
            : ' (document level)')
      );

      try {
        const request: any = {
          createHeader: {
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

        const headerId = (response.replies as any)?.[0]?.createHeader?.headerId;

        return (
          `Successfully created ${args.type} header` +
          (headerId ? ` (ID: ${headerId})` : '') +
          `. Use insertText with segmentId="${headerId}" to add content to the header.`
        );
      } catch (error: any) {
        log.error(`Error creating header: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to create header: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
