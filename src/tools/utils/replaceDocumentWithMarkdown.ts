import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter, MarkdownConversionError } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import type { docs_v1 } from 'googleapis';
import { convertMarkdownToRequests } from '../../markdown-transformer/markdownToDocs.js';
import { TAB_BODY_RANGE_FIELDS } from '../docs/tabFieldMasks.js';

function isRevisionConflict(e: any): boolean {
  const message = String(e?.message ?? '');
  const status = e?.code ?? e?.response?.status;
  return (status === 400 || status === 409) && /revision/i.test(message);
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'replaceDocumentWithMarkdown',
    description:
      "Replaces the entire document body with content parsed from markdown. Supports headings, bold, italic, strikethrough, links, and bullet/numbered lists. Use readDocument with format='markdown' first to get the current content, edit it, then call this tool to apply changes.",
    parameters: DocumentIdParameter.extend({
      markdown: z
        .string()
        .min(1)
        .max(500000)
        .describe('The markdown content to apply to the document.'),
      preserveTitle: z
        .boolean()
        .optional()
        .default(false)
        .describe('If true, preserves the first heading/title and replaces content after it.'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to replace content in. If not specified, replaces content in the first tab.'
        ),
      firstHeadingAsTitle: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          'If true (default), the first H1 heading (# ...) in the markdown is styled as a Google Docs TITLE instead of Heading 1. Useful when the markdown represents a full document whose first line is the document title. Set to false if the first H1 should remain a Heading 1.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Replacing doc ${args.documentId} with markdown (${args.markdown.length} chars)${args.tabId ? ` in tab ${args.tabId}` : ''}`
      );

      try {
        const doc = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: !!args.tabId,
          suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS',
          fields: `revisionId,${
            args.tabId ? TAB_BODY_RANGE_FIELDS : 'body(content(startIndex,endIndex))'
          }`,
        });

        const revisionId = doc.data.revisionId;
        if (!revisionId) {
          throw new UserError(
            'Could not read the document revision; refusing to replace content without a revision pin.'
          );
        }

        let startIndex = 1;
        let bodyContent: any;

        if (args.tabId) {
          const targetTab = GDocsHelpers.findTabById(doc.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
          bodyContent = targetTab.documentTab.body?.content;
        } else {
          bodyContent = doc.data.body?.content;
        }

        if (!bodyContent) {
          throw new UserError('No content found in document/tab');
        }

        const bodyEnd: number = bodyContent[bodyContent.length - 1].endIndex!;
        const endIndex = bodyEnd - 1;

        if (args.preserveTitle) {
          for (const element of bodyContent) {
            if (element.paragraph && element.endIndex) {
              startIndex = element.endIndex;
              break;
            }
          }
        }

        const startedAt = performance.now();
        const insertRequests = convertMarkdownToRequests(
          args.markdown,
          startIndex,
          args.tabId,
          args.firstHeadingAsTitle ? { firstHeadingAsTitle: true } : undefined
        );

        if (insertRequests.length === 0) {
          throw new UserError(
            'The markdown produced no content; refusing to clear the document. No changes were made.'
          );
        }

        const withTab = (range: { startIndex: number; endIndex: number }) =>
          args.tabId ? { ...range, tabId: args.tabId } : range;

        const requests: docs_v1.Schema$Request[] = [];
        const willDelete = endIndex > startIndex;
        if (willDelete) {
          requests.push({
            deleteContentRange: { range: withTab({ startIndex, endIndex }) },
          });
        }

        // deleteContentRange always leaves one undeletable trailing paragraph;
        // strip its bullets and text styles so inserted text does not inherit them.
        const survivorRange = withTab({
          startIndex,
          endIndex: willDelete ? startIndex + 1 : bodyEnd,
        });
        requests.push(
          { deleteParagraphBullets: { range: survivorRange } },
          {
            updateTextStyle: {
              range: survivorRange,
              textStyle: {
                underline: false,
                bold: false,
                italic: false,
                strikethrough: false,
                foregroundColor: {},
                backgroundColor: {},
              },
              fields: 'underline,bold,italic,strikethrough,foregroundColor,backgroundColor',
            },
          },
          ...insertRequests
        );

        log.info(
          `Replacing range ${startIndex}-${endIndex} with ${insertRequests.length} requests in one batchUpdate pinned to revision ${revisionId}`
        );
        try {
          await docs.documents.batchUpdate({
            documentId: args.documentId,
            requestBody: {
              requests,
              writeControl: { requiredRevisionId: revisionId },
            },
          });
        } catch (e: any) {
          if (isRevisionConflict(e)) {
            throw new UserError(
              'The document was modified by someone else while the replacement was being prepared (revision mismatch). No changes were made. Re-read the document and try again.'
            );
          }
          throw e;
        }

        const debugSummary = `Replaced in a single atomic batchUpdate (${requests.length} requests) pinned to revision ${revisionId}, ${Math.round(performance.now() - startedAt)}ms.`;
        log.info(debugSummary);
        return `Successfully replaced document content with ${args.markdown.length} characters of markdown.\n\n${debugSummary}`;
      } catch (error: any) {
        log.error(`Error replacing document with markdown: ${error.message}`);
        if (error instanceof UserError || error instanceof MarkdownConversionError) {
          throw error;
        }
        throw new UserError(`Failed to apply markdown: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
