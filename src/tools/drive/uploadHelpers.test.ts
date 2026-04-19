import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { UserError } from 'fastmcp';
import {
  EXT_TO_MIME,
  GOOGLE_TYPE_MAP,
  autoDetectTarget,
  extensionsForMime,
  inferSourceMime,
  isGoogleWorkspaceMime,
  validateLocalFile,
} from './uploadHelpers.js';

describe('EXT_TO_MIME', () => {
  it.each([
    ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['.csv', 'text/csv'],
    ['.odt', 'application/vnd.oasis.opendocument.text'],
    ['.pdf', 'application/pdf'],
    ['.png', 'image/png'],
    ['.md', 'text/markdown'],
  ])('maps %s → %s', (ext, mime) => {
    expect(EXT_TO_MIME[ext]).toBe(mime);
  });
});

describe('GOOGLE_TYPE_MAP', () => {
  it('maps each shortname to the correct Google Workspace MIME', () => {
    expect(GOOGLE_TYPE_MAP.document).toBe('application/vnd.google-apps.document');
    expect(GOOGLE_TYPE_MAP.spreadsheet).toBe('application/vnd.google-apps.spreadsheet');
    expect(GOOGLE_TYPE_MAP.presentation).toBe('application/vnd.google-apps.presentation');
    expect(GOOGLE_TYPE_MAP.drawing).toBe('application/vnd.google-apps.drawing');
  });
});

describe('inferSourceMime', () => {
  it('returns the mapped MIME for known extensions', () => {
    expect(inferSourceMime('/tmp/report.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  it('is case-insensitive on the extension', () => {
    expect(inferSourceMime('foo.PPTX')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    expect(inferSourceMime('foo.Csv')).toBe('text/csv');
  });

  it('falls back to application/octet-stream for unknown extensions', () => {
    expect(inferSourceMime('mystery.xyz')).toBe('application/octet-stream');
    expect(inferSourceMime('noextension')).toBe('application/octet-stream');
  });
});

describe('autoDetectTarget', () => {
  it.each([
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'spreadsheet'],
    ['application/vnd.ms-excel', 'spreadsheet'],
    ['text/csv', 'spreadsheet'],
    ['text/tab-separated-values', 'spreadsheet'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
    ['application/msword', 'document'],
    ['text/plain', 'document'],
    ['text/markdown', 'document'],
    ['application/rtf', 'document'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation'],
    ['application/vnd.ms-powerpoint', 'presentation'],
    ['image/svg+xml', 'drawing'],
  ])('detects %s → %s', (mime, expected) => {
    expect(autoDetectTarget(mime)).toBe(expected);
  });

  it.each([
    ['application/pdf'],
    ['image/png'],
    ['application/octet-stream'],
    ['application/json'],
  ])('returns null for ambiguous source %s', (mime) => {
    expect(autoDetectTarget(mime)).toBeNull();
  });
});

describe('extensionsForMime', () => {
  it('reverse-maps a MIME type to all known extensions', () => {
    expect(extensionsForMime('image/jpeg').sort()).toEqual(['.jpeg', '.jpg']);
    expect(extensionsForMime('text/csv')).toEqual(['.csv']);
    expect(extensionsForMime('text/html').sort()).toEqual(['.htm', '.html']);
  });

  it('returns an empty array for unknown MIME', () => {
    expect(extensionsForMime('application/x-unknown')).toEqual([]);
  });
});

describe('isGoogleWorkspaceMime', () => {
  it.each([
    ['application/vnd.google-apps.document', true],
    ['application/vnd.google-apps.spreadsheet', true],
    ['application/vnd.google-apps.folder', true],
    ['application/pdf', false],
    ['text/csv', false],
  ])('%s → %s', (mime, expected) => {
    expect(isGoogleWorkspaceMime(mime)).toBe(expected);
  });
});

describe('validateLocalFile', () => {
  let tmpDir: string;
  let insideFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-helpers-'));
    insideFile = path.join(process.cwd(), `validate-test-${Date.now()}.txt`);
    fs.writeFileSync(insideFile, 'hello');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.unlinkSync(insideFile);
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('returns the resolved path for a file inside cwd', () => {
    const result = validateLocalFile(insideFile);
    expect(result).toBe(path.resolve(insideFile));
  });

  it('throws UserError for a path outside cwd', () => {
    const outside = path.join(tmpDir, 'outside.txt');
    fs.writeFileSync(outside, 'nope');
    expect(() => validateLocalFile(outside)).toThrow(UserError);
  });

  it('throws UserError when the file does not exist inside cwd', () => {
    const missing = path.join(process.cwd(), `missing-${Date.now()}.txt`);
    expect(() => validateLocalFile(missing)).toThrow(UserError);
    expect(() => validateLocalFile(missing)).toThrow(/not found/);
  });
});
