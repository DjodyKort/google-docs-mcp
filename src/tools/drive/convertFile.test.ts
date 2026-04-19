import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../clients.js', () => ({
  getDriveClient: vi.fn(),
}));

import { getDriveClient } from '../../clients.js';
import { register } from './convertFile.js';
import { UserError } from 'fastmcp';

const mockGetDriveClient = vi.mocked(getDriveClient);

let toolExecute: (args: any, context: any) => Promise<string>;
const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

function buildDrive({
  sourceName = 'Q4.xlsx',
  sourceMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  copyResponse,
  copyRejects,
  deleteRejects,
  getRejects,
}: {
  sourceName?: string;
  sourceMime?: string;
  copyResponse?: Record<string, any>;
  copyRejects?: any;
  deleteRejects?: any;
  getRejects?: any;
} = {}) {
  const filesGet = getRejects
    ? vi.fn().mockRejectedValue(getRejects)
    : vi.fn().mockResolvedValue({ data: { name: sourceName, mimeType: sourceMime } });

  const filesCopy = copyRejects
    ? vi.fn().mockRejectedValue(copyRejects)
    : vi.fn().mockResolvedValue({
        data: {
          id: 'copy-id',
          name: sourceName,
          mimeType: 'application/vnd.google-apps.spreadsheet',
          webViewLink: 'https://docs.google.com/spreadsheets/d/copy-id',
          ...(copyResponse || {}),
        },
      });

  const filesDelete = deleteRejects
    ? vi.fn().mockRejectedValue(deleteRejects)
    : vi.fn().mockResolvedValue({ data: {} });

  const drive = { files: { get: filesGet, copy: filesCopy, delete: filesDelete } };
  mockGetDriveClient.mockResolvedValue(drive as any);
  return { drive, filesGet, filesCopy, filesDelete };
}

describe('convertFile integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fakeServer = { addTool: (cfg: any) => (toolExecute = cfg.execute) };
    register(fakeServer as any);
  });

  it('auto-detects xlsx source → calls files.copy with google-apps.spreadsheet target', async () => {
    const { filesGet, filesCopy, filesDelete } = buildDrive();

    const result = await toolExecute({ fileId: 'src-123' }, { log: mockLog });

    expect(filesGet).toHaveBeenCalledWith({
      fileId: 'src-123',
      fields: 'name,mimeType',
      supportsAllDrives: true,
    });
    const copyCall = filesCopy.mock.calls[0][0];
    expect(copyCall.fileId).toBe('src-123');
    expect(copyCall.supportsAllDrives).toBe(true);
    expect(copyCall.requestBody.mimeType).toBe('application/vnd.google-apps.spreadsheet');
    expect(copyCall.requestBody.name).toBe('Q4.xlsx');
    expect(copyCall.requestBody.parents).toBeUndefined();
    expect(filesDelete).not.toHaveBeenCalled();

    const parsed = JSON.parse(result);
    expect(parsed.originalFileId).toBe('src-123');
    expect(parsed.originalDeleted).toBe(false);
    expect(parsed.id).toBe('copy-id');
  });

  it('refuses to convert a file that is already a native Google type', async () => {
    const { filesCopy } = buildDrive({
      sourceMime: 'application/vnd.google-apps.document',
    });

    await expect(toolExecute({ fileId: 'doc-1' }, { log: mockLog })).rejects.toThrow(
      /already a native Google/
    );
    expect(filesCopy).not.toHaveBeenCalled();
  });

  it('deleteOriginal=true triggers files.delete after a successful copy', async () => {
    const { filesDelete } = buildDrive();

    const result = await toolExecute(
      { fileId: 'src-123', deleteOriginal: true },
      { log: mockLog }
    );

    expect(filesDelete).toHaveBeenCalledWith({
      fileId: 'src-123',
      supportsAllDrives: true,
    });
    const parsed = JSON.parse(result);
    expect(parsed.originalDeleted).toBe(true);
  });

  it('does not call files.delete when copy fails', async () => {
    const { filesDelete } = buildDrive({ copyRejects: { code: 400 } });

    await expect(
      toolExecute({ fileId: 'src-123', deleteOriginal: true }, { log: mockLog })
    ).rejects.toThrow(/Drive rejected the conversion/);

    expect(filesDelete).not.toHaveBeenCalled();
  });

  it('keeps originalDeleted=false (and does not throw) when delete fails after a successful copy', async () => {
    const { filesDelete } = buildDrive({ deleteRejects: { code: 403 } });

    const result = await toolExecute(
      { fileId: 'src-123', deleteOriginal: true },
      { log: mockLog }
    );

    expect(filesDelete).toHaveBeenCalled();
    expect(JSON.parse(result).originalDeleted).toBe(false);
  });

  it('forwards parentFolderId as requestBody.parents', async () => {
    const { filesCopy } = buildDrive();

    await toolExecute(
      { fileId: 'src-123', parentFolderId: 'dest-folder' },
      { log: mockLog }
    );

    expect(filesCopy.mock.calls[0][0].requestBody.parents).toEqual(['dest-folder']);
  });

  it('uses custom name when provided', async () => {
    const { filesCopy } = buildDrive();

    await toolExecute({ fileId: 'src-123', name: 'My Budget' }, { log: mockLog });

    expect(filesCopy.mock.calls[0][0].requestBody.name).toBe('My Budget');
  });

  it('maps Drive 404 on source files.get to a clear UserError', async () => {
    buildDrive({ getRejects: { code: 404 } });

    await expect(toolExecute({ fileId: 'missing' }, { log: mockLog })).rejects.toThrow(
      /File not found/
    );
  });

  it('throws UserError when source MIME cannot be auto-detected and convertTo="auto"', async () => {
    const { filesCopy } = buildDrive({ sourceMime: 'application/octet-stream' });

    await expect(toolExecute({ fileId: 'src-bin' }, { log: mockLog })).rejects.toThrow(
      /Cannot auto-detect/
    );
    expect(filesCopy).not.toHaveBeenCalled();
  });

  it('explicit convertTo overrides auto-detection', async () => {
    const { filesCopy } = buildDrive({ sourceMime: 'application/octet-stream' });

    await toolExecute(
      { fileId: 'src-bin', convertTo: 'document' },
      { log: mockLog }
    );

    expect(filesCopy.mock.calls[0][0].requestBody.mimeType).toBe(
      'application/vnd.google-apps.document'
    );
  });
});
