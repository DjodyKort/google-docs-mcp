import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import fs from 'node:fs';
import { drive_v3 } from 'googleapis';
import { getDriveClient } from '../../clients.js';
import { inferSourceMime, validateLocalFile } from './uploadHelpers.js';

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

export function register(server: FastMCP) {
  server.addTool({
    name: 'updateFileContent',
    description:
      'Replaces the bytes of an existing Drive file with the contents of a local file. ' +
      'Equivalent to the Drive web UI "Manage versions → Upload new version" flow. ' +
      'If the target fileId is a native Google Workspace file, Drive replaces its content using ' +
      'the same conversion pipeline as uploadAndConvert.',
    parameters: z.object({
      fileId: z.string().describe('Drive file ID of the file whose content should be replaced.'),
      filePath: z
        .string()
        .describe(
          'Local path to the file whose bytes will replace the Drive file. ' +
            'Must be within the current working directory.'
        ),
      mimeType: z
        .string()
        .optional()
        .describe(
          'Explicit MIME type for the uploaded content. Overrides auto-detection from the ' +
            'local file extension. Useful when the extension is unusual.'
        ),
      keepRevision: z
        .boolean()
        .default(false)
        .describe(
          'If true, marks this upload as a permanent revision (keepRevisionForever). ' +
            'Off by default; Drive manages revision retention normally.'
        ),
    }),
    execute: async (args, { log }) => {
      if (isRemote) {
        throw new UserError(
          'updateFileContent reads a local file path and is only available in stdio mode.'
        );
      }

      const drive = await getDriveClient();
      const resolvedPath = validateLocalFile(args.filePath);
      const mimeType = args.mimeType || inferSourceMime(resolvedPath);

      log.info(`Updating file ${args.fileId} with bytes from "${resolvedPath}" (${mimeType})`);

      try {
        const params: drive_v3.Params$Resource$Files$Update = {
          fileId: args.fileId,
          media: { mimeType, body: fs.createReadStream(resolvedPath) },
          fields: 'id,name,mimeType,version,modifiedTime',
          supportsAllDrives: true,
        };
        if (args.keepRevision) params.keepRevisionForever = true;

        const response = await drive.files.update(params);
        const file = response.data;
        return JSON.stringify(
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            version: file.version,
            modifiedTime: file.modifiedTime,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error updating file content: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        if (error.code === 404)
          throw new UserError(`File not found (ID: ${args.fileId}). Check the file ID.`);
        if (error.code === 403)
          throw new UserError(
            `Permission denied for file ${args.fileId}. Ensure you have edit access.`
          );
        throw new UserError(`Failed to update file content: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
