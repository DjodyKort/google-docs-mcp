import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import { assertWorkspaceMimeType, performExport } from './exportHelpers.js';

const SOURCE_MIME = 'application/vnd.google-apps.spreadsheet';

const FORMAT_TO_MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pdf: 'application/pdf',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'application/zip',
} as const;

const ExportSpreadsheetParameters = z.object({
  spreadsheetId: z
    .string()
    .describe('The Google Sheets ID from the URL (between /d/ and /edit).'),
  format: z
    .enum(['xlsx', 'ods', 'pdf', 'csv', 'tsv', 'html'])
    .describe(
      'Export format. Matches the Google Sheets "File > Download" menu. ' +
        '"csv" and "tsv" export the first sheet only. "html" returns a zipped HTML bundle (.zip).'
    ),
  savePath: z
    .string()
    .optional()
    .describe(
      'Local path to save the exported file. Parent directories are created automatically. ' +
        "If omitted, saves to the current working directory as <sheetName>.<ext>."
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
    name: 'exportSpreadsheet',
    description:
      'Exports a Google Sheets spreadsheet to a local file in one of the formats available in the ' +
      '"File > Download" menu: xlsx, ods, pdf, csv (first sheet), tsv (first sheet), html (zipped).',
    parameters: ExportSpreadsheetParameters,
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const { name } = await assertWorkspaceMimeType(drive, args.spreadsheetId, SOURCE_MIME);
      const exportMime = FORMAT_TO_MIME[args.format];
      return performExport({
        drive,
        fileId: args.spreadsheetId,
        fileName: name,
        exportMime,
        savePath: args.savePath,
        returnAs: args.returnAs,
        log,
      });
    },
  });
}
