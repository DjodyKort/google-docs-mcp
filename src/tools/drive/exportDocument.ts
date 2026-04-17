import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import { assertWorkspaceMimeType, performExport } from './exportHelpers.js';

const SOURCE_MIME = 'application/vnd.google-apps.document';

const FORMAT_TO_MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf',
  txt: 'text/plain',
  html: 'application/zip',
  epub: 'application/epub+zip',
  markdown: 'text/markdown',
} as const;

const ExportDocumentParameters = z.object({
  documentId: z.string().describe('The Google Doc ID from the URL (between /d/ and /edit).'),
  format: z
    .enum(['pdf', 'docx', 'odt', 'rtf', 'txt', 'html', 'epub', 'markdown'])
    .describe(
      'Export format. Matches the options in the Google Docs "File > Download" menu. ' +
        '"html" returns a zipped HTML bundle (.zip).'
    ),
  savePath: z
    .string()
    .optional()
    .describe(
      'Local path to save the exported file. Parent directories are created automatically. ' +
        "If omitted, saves to the current working directory as <docName>.<ext>."
    ),
  returnAs: z
    .enum(['url', 'content'])
    .optional()
    .default('url')
    .describe(
      'Remote mode only. "url" returns a short-lived download URL; "content" returns the export inline.'
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'exportDocument',
    description:
      'Exports a Google Doc to a local file in one of the formats available in the Google Docs ' +
      '"File > Download" menu: pdf, docx, odt, rtf, txt, html (zipped), epub, markdown.',
    parameters: ExportDocumentParameters,
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const { name } = await assertWorkspaceMimeType(drive, args.documentId, SOURCE_MIME);
      const exportMime = FORMAT_TO_MIME[args.format];
      return performExport({
        drive,
        fileId: args.documentId,
        fileName: name,
        exportMime,
        savePath: args.savePath,
        returnAs: args.returnAs,
        log,
      });
    },
  });
}
