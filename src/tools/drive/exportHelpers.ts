import type { drive_v3 } from 'googleapis';
import { UserError, imageContent } from 'fastmcp';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { requestClients } from '../../remoteWrapper.js';
import { createDownloadToken } from '../../downloadProxy.js';

const isRemote = process.env.MCP_TRANSPORT === 'httpStream';

export const EXPORT_MIME_TO_EXTENSION: Record<string, string> = {
  'text/markdown': '.md',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'text/tab-separated-values': '.tsv',
  'text/html': '.html',
  'application/pdf': '.pdf',
  'application/rtf': '.rtf',
  'application/epub+zip': '.epub',
  'application/zip': '.zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/svg+xml': '.svg',
  'application/vnd.google-apps.script+json': '.json',
};

const MAX_INLINE_BYTES = 100 * 1024 * 1024;

const WORKSPACE_TOOL_HINT: Record<string, string> = {
  'application/vnd.google-apps.document': 'exportDocument',
  'application/vnd.google-apps.spreadsheet': 'exportSpreadsheet',
  'application/vnd.google-apps.presentation': 'exportPresentation',
  'application/vnd.google-apps.drawing': 'exportDrawing',
};

export function ensureWithinCwd(filePath: string): string {
  const cwd = path.resolve(process.cwd());
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
    throw new UserError('File path must be within the working directory.');
  }
  return resolved;
}

export interface FileMetadata {
  name: string;
  mimeType: string;
}

export async function assertWorkspaceMimeType(
  drive: drive_v3.Drive,
  fileId: string,
  expectedMime: string
): Promise<FileMetadata> {
  const res = await drive.files.get({
    fileId,
    fields: 'name,mimeType',
    supportsAllDrives: true,
  });
  const name = res.data.name || 'export';
  const mimeType = res.data.mimeType || '';
  if (mimeType !== expectedMime) {
    const hint = WORKSPACE_TOOL_HINT[mimeType];
    const suggestion = hint ? ` Use \`${hint}\` for files of type "${mimeType}".` : '';
    throw new UserError(
      `File ${fileId} has MIME type "${mimeType}", expected "${expectedMime}".${suggestion}`
    );
  }
  return { name, mimeType };
}

export interface PerformExportOptions {
  drive: drive_v3.Drive;
  fileId: string;
  fileName: string;
  exportMime: string;
  savePath?: string;
  returnAs?: 'url' | 'content';
  log: { info: (msg: string) => void; error: (msg: string) => void };
}

export async function performExport(
  opts: PerformExportOptions
): Promise<string | { content: any[] }> {
  const { drive, fileId, fileName, exportMime, savePath, returnAs, log } = opts;
  const ext = EXPORT_MIME_TO_EXTENSION[exportMime] || '';
  const baseName = path.parse(fileName).name;
  const resolvedFileName = baseName + ext;

  try {
    // ---------- Remote mode ----------
    if (isRemote) {
      if (returnAs !== 'content') {
        const store = requestClients.getStore();
        if (!store) throw new UserError('Request context missing.');

        const token = createDownloadToken({
          fileId,
          accessToken: store.accessToken,
          exportMime,
          fileName: resolvedFileName,
          mimeType: exportMime,
          isWorkspace: true,
        });

        return JSON.stringify(
          {
            downloadUrl: `${process.env.BASE_URL}/download/${token}`,
            fileName: resolvedFileName,
            exportedAs: exportMime,
          },
          null,
          2
        );
      }

      log.info(`Exporting ${fileId} as ${exportMime}`);
      const res = await drive.files.export(
        { fileId, mimeType: exportMime },
        { responseType: 'arraybuffer' }
      );
      const fileBuffer = Buffer.from(res.data as ArrayBuffer);
      const content: any[] = [];

      if (exportMime.startsWith('text/') && fileBuffer.length <= MAX_INLINE_BYTES) {
        content.push({ type: 'text' as const, text: fileBuffer.toString('utf-8') });
      } else if (exportMime.startsWith('image/') && fileBuffer.length <= MAX_INLINE_BYTES) {
        content.push(await imageContent({ buffer: fileBuffer }));
      } else if (fileBuffer.length <= MAX_INLINE_BYTES) {
        content.push({
          type: 'resource' as const,
          resource: {
            uri: `gdrive:///${fileId}/${resolvedFileName}`,
            blob: fileBuffer.toString('base64'),
            mimeType: exportMime,
          },
        });
      } else {
        throw new UserError(
          `Export too large for inline transfer (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB, limit 100MB).`
        );
      }

      content.push({
        type: 'text' as const,
        text: JSON.stringify({
          fileName: resolvedFileName,
          exportedAs: exportMime,
          sizeBytes: fileBuffer.length,
        }),
      });

      return { content };
    }

    // ---------- Stdio mode ----------
    let resolvedSavePath: string;
    if (savePath) {
      resolvedSavePath = ensureWithinCwd(savePath);
    } else {
      resolvedSavePath = path.join(process.cwd(), resolvedFileName);
    }
    resolvedSavePath = ensureWithinCwd(resolvedSavePath);

    fs.mkdirSync(path.dirname(resolvedSavePath), { recursive: true });

    log.info(`Exporting ${fileId} as ${exportMime} to ${resolvedSavePath}`);
    try {
      const res = await drive.files.export(
        { fileId, mimeType: exportMime },
        { responseType: 'stream' }
      );
      await pipeline(res.data as NodeJS.ReadableStream, fs.createWriteStream(resolvedSavePath));
    } catch (err) {
      try {
        fs.unlinkSync(resolvedSavePath);
      } catch {
        /* ignore */
      }
      throw err;
    }

    const sizeBytes = fs.statSync(resolvedSavePath).size;

    return JSON.stringify(
      {
        savedTo: resolvedSavePath,
        fileName: resolvedFileName,
        exportedAs: exportMime,
        sizeBytes,
      },
      null,
      2
    );
  } catch (error: any) {
    log.error(`Error exporting file ${fileId}: ${error.message || error}`);
    if (error instanceof UserError) throw error;
    if (error.code === 404) throw new UserError(`File not found (ID: ${fileId}).`);
    if (error.code === 403)
      throw new UserError(`Permission denied for file ${fileId}.`);
    throw new UserError(`Failed to export file: ${error.message || 'Unknown error'}`);
  }
}
