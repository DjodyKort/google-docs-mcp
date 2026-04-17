import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import { assertWorkspaceMimeType, performExport } from './exportHelpers.js';

const SOURCE_MIME = 'application/vnd.google-apps.drawing';

const FORMAT_TO_MIME = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
} as const;

const ExportDrawingParameters = z.object({
  drawingId: z.string().describe('The Google Drawing ID from the URL (between /d/ and /edit).'),
  format: z
    .enum(['pdf', 'png', 'jpg', 'svg'])
    .describe('Export format. Matches the Google Drawings "File > Download" menu.'),
  savePath: z
    .string()
    .optional()
    .describe(
      'Local path to save the exported file. Parent directories are created automatically. ' +
        "If omitted, saves to the current working directory as <drawingName>.<ext>."
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
    name: 'exportDrawing',
    description:
      'Exports a Google Drawing to a local file in one of the formats available in the ' +
      '"File > Download" menu: pdf, png, jpg, svg.',
    parameters: ExportDrawingParameters,
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const { name } = await assertWorkspaceMimeType(drive, args.drawingId, SOURCE_MIME);
      const exportMime = FORMAT_TO_MIME[args.format];
      return performExport({
        drive,
        fileId: args.drawingId,
        fileName: name,
        exportMime,
        savePath: args.savePath,
        returnAs: args.returnAs,
        log,
      });
    },
  });
}
