import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import { assertWorkspaceMimeType, performExport } from './exportHelpers.js';

const SOURCE_MIME = 'application/vnd.google-apps.presentation';

const FORMAT_TO_MIME = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  pdf: 'application/pdf',
  txt: 'text/plain',
} as const;

const ExportPresentationParameters = z.object({
  presentationId: z
    .string()
    .describe('The Google Slides ID from the URL (between /d/ and /edit).'),
  format: z
    .enum(['pptx', 'odp', 'pdf', 'txt'])
    .describe('Export format. Matches the Google Slides "File > Download" menu.'),
  savePath: z
    .string()
    .optional()
    .describe(
      'Local path to save the exported file. Parent directories are created automatically. ' +
        "If omitted, saves to the current working directory as <slidesName>.<ext>."
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
    name: 'exportPresentation',
    description:
      'Exports a Google Slides presentation to a local file in one of the formats available in the ' +
      '"File > Download" menu: pptx, odp, pdf, txt. ' +
      'Per-slide image exports (png/jpg/svg of one slide) are not supported via this tool.',
    parameters: ExportPresentationParameters,
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      const { name } = await assertWorkspaceMimeType(drive, args.presentationId, SOURCE_MIME);
      const exportMime = FORMAT_TO_MIME[args.format];
      return performExport({
        drive,
        fileId: args.presentationId,
        fileName: name,
        exportMime,
        savePath: args.savePath,
        returnAs: args.returnAs,
        log,
      });
    },
  });
}
