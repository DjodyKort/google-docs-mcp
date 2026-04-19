import fs from 'node:fs';
import path from 'node:path';
import { UserError } from 'fastmcp';
import { ensureWithinCwd } from './exportHelpers.js';

export const EXT_TO_MIME: Record<string, string> = {
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.rtf': 'application/rtf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export const GOOGLE_TYPE_MAP = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
  drawing: 'application/vnd.google-apps.drawing',
} as const;

export type GoogleTargetShort = keyof typeof GOOGLE_TYPE_MAP;

export const GOOGLE_TARGETS: GoogleTargetShort[] = [
  'document',
  'spreadsheet',
  'presentation',
  'drawing',
];

const DOCUMENT_SOURCES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.oasis.opendocument.text',
  'application/rtf',
  'text/plain',
  'text/markdown',
  'text/html',
]);

const SPREADSHEET_SOURCES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'text/csv',
  'text/tab-separated-values',
]);

const PRESENTATION_SOURCES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
]);

const DRAWING_SOURCES = new Set(['image/svg+xml']);

export function inferSourceMime(localPath: string): string {
  const ext = path.extname(localPath).toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function autoDetectTarget(sourceMime: string): GoogleTargetShort | null {
  if (DOCUMENT_SOURCES.has(sourceMime)) return 'document';
  if (SPREADSHEET_SOURCES.has(sourceMime)) return 'spreadsheet';
  if (PRESENTATION_SOURCES.has(sourceMime)) return 'presentation';
  if (DRAWING_SOURCES.has(sourceMime)) return 'drawing';
  return null;
}

export function extensionsForMime(mime: string): string[] {
  const matches: string[] = [];
  for (const [ext, m] of Object.entries(EXT_TO_MIME)) {
    if (m === mime) matches.push(ext);
  }
  return matches;
}

export function isGoogleWorkspaceMime(mime: string): boolean {
  return mime.startsWith('application/vnd.google-apps.');
}

export function validateLocalFile(localPath: string): string {
  const resolved = ensureWithinCwd(localPath);
  if (!fs.existsSync(resolved)) {
    throw new UserError(`File not found: ${localPath}`);
  }
  return resolved;
}
