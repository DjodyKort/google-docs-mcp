import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { drive_v3 } from 'googleapis';
import { getDriveClient } from '../../clients.js';
import {
  GOOGLE_TARGETS,
  GOOGLE_TYPE_MAP,
  GoogleTargetShort,
  autoDetectTarget,
  isGoogleWorkspaceMime,
} from './uploadHelpers.js';

export function register(server: FastMCP) {
  server.addTool({
    name: 'convertFile',
    description:
      'Converts an already-uploaded non-Google Drive file (e.g. an .xlsx in Drive) to a native Google ' +
      'Workspace format by creating a new file via `files.copy` with the target MIME type. ' +
      'Equivalent to the Drive web UI "Right-click → Open with → Save as Google …" flow. ' +
      'The original file is preserved by default; set deleteOriginal=true to remove it after a successful copy.',
    parameters: z.object({
      fileId: z.string().describe('Drive file ID of the source (non-Google) file to convert.'),
      convertTo: z
        .enum(['document', 'spreadsheet', 'presentation', 'drawing', 'auto'])
        .default('auto')
        .describe(
          'Target Google Workspace type. "auto" picks based on the source MIME type ' +
            '(e.g. xlsx → spreadsheet, pptx → presentation, docx → document).'
        ),
      name: z
        .string()
        .optional()
        .describe('Name for the new converted file. Defaults to the source file name.'),
      parentFolderId: z
        .string()
        .optional()
        .describe('Destination folder for the new file. Defaults to Drive root.'),
      deleteOriginal: z
        .boolean()
        .default(false)
        .describe(
          'If true, deletes the source file after the conversion succeeds. ' +
            'Off by default so the conversion is non-destructive.'
        ),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info(`Converting file ${args.fileId} (target: ${args.convertTo})`);

      let sourceName: string;
      let sourceMime: string;
      try {
        const metaRes = await drive.files.get({
          fileId: args.fileId,
          fields: 'name,mimeType',
          supportsAllDrives: true,
        });
        sourceName = metaRes.data.name || 'converted';
        sourceMime = metaRes.data.mimeType || '';
      } catch (error: any) {
        log.error(`Error fetching source metadata: ${error.message || error}`);
        if (error.code === 404)
          throw new UserError(`File not found (ID: ${args.fileId}). Check the file ID.`);
        if (error.code === 403)
          throw new UserError(`Permission denied for file ${args.fileId}.`);
        throw new UserError(`Failed to read source file: ${error.message || 'Unknown error'}`);
      }

      if (isGoogleWorkspaceMime(sourceMime)) {
        throw new UserError(
          `File ${args.fileId} is already a native Google Workspace file (${sourceMime}). ` +
            `Use \`copyFile\` to duplicate it instead of converting.`
        );
      }

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

      let newFile: drive_v3.Schema$File;
      try {
        const metadata: drive_v3.Schema$File = {
          name: args.name || sourceName,
          mimeType: targetMime,
        };
        if (args.parentFolderId) metadata.parents = [args.parentFolderId];

        const copyRes = await drive.files.copy({
          fileId: args.fileId,
          requestBody: metadata,
          fields: 'id,name,mimeType,webViewLink',
          supportsAllDrives: true,
        });
        newFile = copyRes.data;
      } catch (error: any) {
        log.error(`Error during files.copy: ${error.message || error}`);
        if (error.code === 400)
          throw new UserError(
            `Drive rejected the conversion from "${sourceMime}" to "${targetMime}". ` +
              `Call listSupportedConversions to see allowed source→target pairs.`
          );
        if (error.code === 403)
          throw new UserError(
            `Permission denied. Ensure you can read the source and write to the destination folder.`
          );
        throw new UserError(`Failed to convert file: ${error.message || 'Unknown error'}`);
      }

      let originalDeleted = false;
      if (args.deleteOriginal) {
        try {
          await drive.files.delete({ fileId: args.fileId, supportsAllDrives: true });
          originalDeleted = true;
        } catch (error: any) {
          log.error(`Conversion succeeded but could not delete original: ${error.message || error}`);
        }
      }

      return JSON.stringify(
        {
          id: newFile.id,
          name: newFile.name,
          mimeType: newFile.mimeType,
          url: newFile.webViewLink,
          originalFileId: args.fileId,
          originalDeleted,
        },
        null,
        2
      );
    },
  });
}
