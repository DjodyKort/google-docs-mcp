import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { drive_v3 } from 'googleapis';
import { getDriveClient } from '../../clients.js';
import { inferSourceMime, validateLocalFile } from './uploadHelpers.js';

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

export function register(server: FastMCP) {
  server.addTool({
    name: 'uploadFile',
    description:
      'Uploads a local file to Google Drive, preserving its native format (no conversion). ' +
      'MIME type is auto-detected from the file extension unless overridden. ' +
      'For conversion to Google Docs/Sheets/Slides on upload, use `uploadAndConvert` instead.',
    parameters: z.object({
      filePath: z
        .string()
        .describe(
          'Local path to the file to upload. Must be within the current working directory.'
        ),
      name: z
        .string()
        .optional()
        .describe('Name for the uploaded file on Drive. Defaults to the local filename.'),
      parentFolderId: z
        .string()
        .optional()
        .describe('ID of the destination folder. If omitted, uploads to Drive root.'),
      mimeType: z
        .string()
        .optional()
        .describe(
          'Explicit MIME type. Overrides auto-detection from the file extension. ' +
            'Use for unusual extensions or when the mapping is ambiguous.'
        ),
      description: z.string().optional().describe('Optional description stored on the Drive file.'),
    }),
    execute: async (args, { log }) => {
      if (isRemote) {
        throw new UserError(
          'uploadFile reads a local file path and is only available in stdio mode. ' +
            'Upload via the Drive web UI when running remotely.'
        );
      }

      const drive = await getDriveClient();
      const resolvedPath = validateLocalFile(args.filePath);
      const fileName = args.name || path.basename(resolvedPath);
      const mimeType = args.mimeType || inferSourceMime(resolvedPath);

      log.info(`Uploading "${resolvedPath}" as "${fileName}" (${mimeType})`);

      try {
        const metadata: drive_v3.Schema$File = { name: fileName, mimeType };
        if (args.parentFolderId) metadata.parents = [args.parentFolderId];
        if (args.description) metadata.description = args.description;

        const response = await drive.files.create({
          requestBody: metadata,
          media: { mimeType, body: fs.createReadStream(resolvedPath) },
          fields: 'id,name,mimeType,webViewLink',
          supportsAllDrives: true,
        });

        const file = response.data;
        return JSON.stringify(
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            url: file.webViewLink,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error uploading file: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404)
          throw new UserError('Parent folder not found. Check the parentFolderId.');
        if (error.code === 403)
          throw new UserError(
            'Permission denied. Ensure you have write access to the destination folder.'
          );
        throw new UserError(`Failed to upload file: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
