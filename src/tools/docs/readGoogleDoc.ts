import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient, getDriveClient } from '../../clients.js';
import { DocumentIdParameter, NotImplementedError } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { docsJsonToMarkdown } from '../../markdown-transformer/index.js';
import { buildTabsFieldMask } from './tabFieldMasks.js';

type StartFrom = 'beginning' | 'end' | 'index';

interface SliceResult {
  slice: string;
  start: number;
  end: number;
  total: number;
}

function sliceOutput(
  content: string,
  startFrom: StartFrom,
  startIndex: number | undefined,
  maxLength: number | undefined
): SliceResult {
  const total = content.length;
  let start: number;
  if (startFrom === 'beginning') {
    start = 0;
  } else if (startFrom === 'end') {
    start = Math.max(0, total - (maxLength ?? total));
  } else {
    // 1-based → 0-based, clamped
    start = Math.min(total, Math.max(0, (startIndex ?? 1) - 1));
  }
  const end = maxLength !== undefined ? Math.min(total, start + maxLength) : total;
  return { slice: content.substring(start, end), start, end, total };
}

function wrapTextResponse(result: SliceResult, label = 'Content'): string {
  const { slice, start, end, total } = result;
  const rangeDesc =
    start === 0 && end === total
      ? `${total} characters`
      : `chars ${start + 1}..${end} of ${total}`;
  let out = `${label} (${rangeDesc}):\n---\n${slice}`;
  if (end < total) {
    const remaining = total - end;
    out += `\n\n... [${remaining} more characters. Pass startFrom='index' with startIndex=${end + 1} to continue.]`;
  }
  if (start > 0) {
    out = `[Starting at char ${start + 1}]\n` + out;
  }
  return out;
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'readDocument',
    description:
      "Reads the content of a Google Document. Returns plain text by default. Use format='markdown' to get formatted content suitable for editing and re-uploading with replaceDocumentWithMarkdown, or format='json' for the raw document structure. " +
      "startFrom is required — pick 'beginning', 'end', or 'index' to make the slice explicit. Pair with maxLength to paginate long documents.",
    parameters: DocumentIdParameter.extend({
      format: z
        .enum(['text', 'json', 'markdown'])
        .optional()
        .default('text')
        .describe(
          "Output format: 'text' (plain text), 'json' (raw API structure, complex), 'markdown' (experimental conversion)."
        ),
      startFrom: z
        .enum(['beginning', 'end', 'index'])
        .describe(
          "Required. Where to start reading in the rendered output string: 'beginning' (char 1), 'end' (last maxLength chars — maxLength is required), or 'index' (startIndex is required)."
        ),
      startIndex: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "1-based character position in the rendered output string (NOT the Google Docs API document index). Required when startFrom='index'."
        ),
      maxLength: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Maximum characters to return from the chosen start position. Omit to read until the end. Required when startFrom='end'."
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to read. If not specified, reads the first tab (or legacy document.body for documents without tabs).'
        ),
    })
      .refine((d) => d.startFrom !== 'index' || d.startIndex !== undefined, {
        message: "startIndex is required when startFrom='index'",
        path: ['startIndex'],
      })
      .refine((d) => d.startFrom !== 'end' || d.maxLength !== undefined, {
        message: "maxLength is required when startFrom='end' (how many trailing chars to return)",
        path: ['maxLength'],
      }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Reading Google Doc: ${args.documentId}, Format: ${args.format}, startFrom: ${args.startFrom}${args.tabId ? `, Tab: ${args.tabId}` : ''}`
      );

      try {
        // Determine if we need tabs content
        const needsTabsContent = !!args.tabId;

        const fields =
          args.format === 'json' || args.format === 'markdown'
            ? '*' // Get everything for structure analysis
            : 'body(content(paragraph(elements(textRun(content)))))'; // Just text content

        const res = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: needsTabsContent,
          suggestionsViewMode: 'PREVIEW_WITHOUT_SUGGESTIONS',
          fields: needsTabsContent
            ? `title,documentId,${buildTabsFieldMask('documentTab(body,documentStyle,namedStyles,lists)')}`
            : fields,
        });
        log.info(`Fetched doc: ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`);

        // If tabId is specified, find the specific tab
        let contentSource: any;
        if (args.tabId) {
          const targetTab = GDocsHelpers.findTabById(res.data, args.tabId);
          if (!targetTab) {
            throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
          }
          if (!targetTab.documentTab) {
            throw new UserError(
              `Tab "${args.tabId}" does not have content (may not be a document tab).`
            );
          }
          contentSource = { body: targetTab.documentTab.body };
          log.info(`Using content from tab: ${targetTab.tabProperties?.title || 'Untitled'}`);
        } else {
          // Use the document body (backward compatible)
          contentSource = res.data;
        }

        if (args.format === 'json') {
          const jsonContent = JSON.stringify(contentSource, null, 2);
          const result = sliceOutput(
            jsonContent,
            args.startFrom,
            args.startIndex,
            args.maxLength
          );
          const { slice, start, end, total } = result;
          if (start === 0 && end === total) return slice;
          const continuation =
            end < total
              ? `\n... [JSON chars ${start + 1}..${end} of ${total}. Pass startFrom='index' with startIndex=${end + 1} to continue.]`
              : `\n... [JSON chars ${start + 1}..${end} of ${total}.]`;
          return slice + continuation;
        }

        if (args.format === 'markdown') {
          const markdownContent = docsJsonToMarkdown(contentSource);
          log.info(`Generated markdown: ${markdownContent.length} characters`);
          const result = sliceOutput(
            markdownContent,
            args.startFrom,
            args.startIndex,
            args.maxLength
          );
          return wrapTextResponse(result, 'Markdown');
        }

        // Default: Text format - extract all text content
        let textContent = '';
        let elementCount = 0;

        const extractFromElements = (elements: any[]) => {
          for (const element of elements || []) {
            elementCount++;
            if (element.paragraph?.elements) {
              for (const pe of element.paragraph.elements) {
                if (pe.textRun?.content) textContent += pe.textRun.content;
              }
            }
            if (element.table?.tableRows) {
              for (const row of element.table.tableRows) {
                for (const cell of row.tableCells || []) {
                  extractFromElements(cell.content || []);
                }
              }
            }
          }
        };

        // Process all content elements from contentSource
        contentSource.body?.content?.forEach((element: any) => {
          extractFromElements([element]);
        });

        if (!textContent.trim()) return 'Document found, but appears empty.';

        log.info(
          `Document contains ${textContent.length} characters across ${elementCount} elements`
        );

        const result = sliceOutput(
          textContent,
          args.startFrom,
          args.startIndex,
          args.maxLength
        );
        return wrapTextResponse(result);
      } catch (error: any) {
        log.error(
          `Error reading doc ${args.documentId}: ${error.message || 'Unknown error'} (code: ${error.code || 'N/A'})`
        );
        // Handle errors thrown by helpers or API directly
        if (error instanceof UserError) throw error;
        if (error instanceof NotImplementedError) throw error;
        // Generic fallback for API errors not caught by helpers
        if (error.code === 404) throw new UserError(`Doc not found (ID: ${args.documentId}).`);
        if (error.code === 403) {
          // The Docs API may be blocked by Workspace admin policy even when the Drive API is
          // accessible. Fall back to drive.files.export() for plain-text format, which uses
          // the Drive API and respects supportsAllDrives for Shared Drive documents.
          if (!args.format || args.format === 'text') {
            try {
              log.info(
                `Docs API returned 403, falling back to Drive export for ${args.documentId}`
              );
              const drive = await getDriveClient();
              const exportRes = await drive.files.export(
                { fileId: args.documentId, mimeType: 'text/plain' },
                { responseType: 'text' }
              );
              const textContent = (exportRes as any).data as string;
              if (!textContent?.trim()) return 'Document found, but appears empty.';
              const result = sliceOutput(
                textContent,
                args.startFrom,
                args.startIndex,
                args.maxLength
              );
              return wrapTextResponse(result);
            } catch (exportError: any) {
              log.error(`Drive export fallback also failed: ${exportError.message}`);
            }
          }
          throw new UserError(
            `Permission denied for doc (ID: ${args.documentId}). The Google Docs API may be restricted by your Workspace admin.`
          );
        }
        // Extract detailed error information from Google API response
        const errorDetails =
          error.response?.data?.error?.message || error.message || 'Unknown error';
        const errorCode = error.response?.data?.error?.code || error.code;
        throw new UserError(
          `Failed to read doc: ${errorDetails}${errorCode ? ` (Code: ${errorCode})` : ''}`
        );
      }
    },
  });
}
