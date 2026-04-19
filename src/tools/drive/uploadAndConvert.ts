import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { drive_v3 } from 'googleapis';
import { getDriveClient } from '../../clients.js';
import {
  GOOGLE_TARGETS,
  GOOGLE_TYPE_MAP,
  GoogleTargetShort,
  autoDetectTarget,
  inferSourceMime,
  validateLocalFile,
} from './uploadHelpers.js';

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

export function register(server: FastMCP) {
  server.addTool({
    name: 'uploadAndConvert',
    description:
      'Uploads a local file to Google Drive AND converts it to a native Google Workspace format ' +
      '(Docs, Sheets, Slides, or Drawing) in a single call. ' +
      'Equivalent to the Drive web UI "Open with → Google …" flow when "Convert uploads" is enabled. ' +
      'For upload without conversion, use `uploadFile` instead.',
    parameters: z.object({
      filePath: z
        .string()
        .describe(
          'Local path to the file to upload. Must be within the current working directory.'
        ),
      convertTo: z
        .enum(['document', 'spreadsheet', 'presentation', 'drawing', 'auto'])
        .default('auto')
        .describe(
          'Target Google Workspace type. "auto" picks based on the source extension ' +
            '(e.g. .xlsx → spreadsheet, .pptx → presentation, .docx/.odt/.md → document).'
        ),
      name: z
        .string()
        .optional()
        .describe(
          'Name for the converted file on Drive. Defaults to the local filename (extension stripped).'
        ),
      parentFolderId: z
        .string()
        .optional()
        .describe('ID of the destination folder. If omitted, creates in Drive root.'),
      ocrLanguage: z
        .string()
        .optional()
        .describe(
          'BCP-47 language hint for OCR when converting an image to a Google Doc (e.g. "en", "nl"). ' +
            'Ignored for non-image sources.'
        ),
    }),
    execute: async (args, { log }) => {
      if (isRemote) {
        throw new UserError(
          'uploadAndConvert reads a local file path and is only available in stdio mode. ' +
            'Use the Drive web UI for remote sessions.'
        );
      }

      const drive = await getDriveClient();
      const resolvedPath = validateLocalFile(args.filePath);
      const sourceMime = inferSourceMime(resolvedPath);

      const convertTo = args.convertTo ?? 'auto';
      let target: GoogleTargetShort;
      if (convertTo === 'auto') {
        const detected = autoDetectTarget(sourceMime);
        if (!detected) {
          throw new UserError(
            `Cannot auto-detect a Google Workspace target for source MIME "${sourceMime}". ` +
              `Specify convertTo explicitly (one of: ${GOOGLE_TARGETS.join(', ')}).`
          );
        }
        target = detected;
      } else {
        target = convertTo;
      }

      const targetMime = GOOGLE_TYPE_MAP[target];
      const baseName = path.basename(resolvedPath, path.extname(resolvedPath));
      const fileName = args.name || baseName;

      log.info(`Uploading "${resolvedPath}" and converting to ${target} ("${fileName}")`);

      try {
        const metadata: drive_v3.Schema$File = { name: fileName, mimeType: targetMime };
        if (args.parentFolderId) metadata.parents = [args.parentFolderId];

        const params: drive_v3.Params$Resource$Files$Create = {
          requestBody: metadata,
          media: { mimeType: sourceMime, body: fs.createReadStream(resolvedPath) },
          fields: 'id,name,mimeType,webViewLink',
          supportsAllDrives: true,
        };
        if (args.ocrLanguage) params.ocrLanguage = args.ocrLanguage;

        const response = await drive.files.create(params);
        const file = response.data;
        return JSON.stringify(
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            url: file.webViewLink,
            convertedFrom: sourceMime,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error uploading+converting: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 400)
          throw new UserError(
            `Drive rejected the conversion from "${sourceMime}" to "${targetMime}". ` +
              `Call listSupportedConversions to see allowed source→target pairs.`
          );
        if (error.code === 404)
          throw new UserError('Parent folder not found. Check the parentFolderId.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Ensure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to upload and convert: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
