import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

vi.mock('../../clients.js', () => ({
  getDriveClient: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(() => true),
      createReadStream: vi.fn(() => 'mock-read-stream'),
    },
    existsSync: vi.fn(() => true),
    createReadStream: vi.fn(() => 'mock-read-stream'),
  };
});

import fs from 'node:fs';
import { getDriveClient } from '../../clients.js';
import { register } from './uploadFile.js';
import { UserError } from 'fastmcp';

const mockGetDriveClient = vi.mocked(getDriveClient);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockCreateReadStream = vi.mocked(fs.createReadStream);

let toolExecute: (args: any, context: any) => Promise<string>;
const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

function createMockDrive(createResponse: Record<string, any> = {}) {
  const filesCreate = vi.fn().mockResolvedValue({
    data: {
      id: 'new-file-id',
      name: 'report.csv',
      mimeType: 'text/csv',
      webViewLink: 'https://drive.google.com/file/d/new-file-id/view',
      ...createResponse,
    },
  });
  const drive = { files: { create: filesCreate } };
  mockGetDriveClient.mockResolvedValue(drive as any);
  return { drive, filesCreate };
}

describe('uploadFile integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockCreateReadStream.mockReturnValue('mock-read-stream' as any);
    const fakeServer = { addTool: (cfg: any) => (toolExecute = cfg.execute) };
    register(fakeServer as any);
  });

  it('uploads with auto-detected MIME, defaults name to basename, matches media+metadata MIMEs', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'report.csv');

    const result = await toolExecute({ filePath: localPath }, { log: mockLog });

    expect(filesCreate).toHaveBeenCalledTimes(1);
    const call = filesCreate.mock.calls[0][0];
    expect(call.supportsAllDrives).toBe(true);
    expect(call.fields).toBe('id,name,mimeType,webViewLink');
    expect(call.requestBody.name).toBe('report.csv');
    expect(call.requestBody.mimeType).toBe('text/csv');
    expect(call.requestBody.parents).toBeUndefined();
    expect(call.media.mimeType).toBe('text/csv');
    expect(call.media.body).toBe('mock-read-stream');
    expect(mockCreateReadStream).toHaveBeenCalledWith(path.resolve(localPath));

    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      id: 'new-file-id',
      name: 'report.csv',
      mimeType: 'text/csv',
      url: 'https://drive.google.com/file/d/new-file-id/view',
    });
  });

  it('forwards parentFolderId as requestBody.parents', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'report.csv');

    await toolExecute(
      { filePath: localPath, parentFolderId: 'folder-xyz' },
      { log: mockLog }
    );

    expect(filesCreate.mock.calls[0][0].requestBody.parents).toEqual(['folder-xyz']);
  });

  it('uses custom name when supplied', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'report.csv');

    await toolExecute({ filePath: localPath, name: 'Q4 Results.csv' }, { log: mockLog });

    expect(filesCreate.mock.calls[0][0].requestBody.name).toBe('Q4 Results.csv');
  });

  it('allows explicit mimeType override', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'anything.bin');

    await toolExecute(
      { filePath: localPath, mimeType: 'application/octet-stream' },
      { log: mockLog }
    );

    const call = filesCreate.mock.calls[0][0];
    expect(call.requestBody.mimeType).toBe('application/octet-stream');
    expect(call.media.mimeType).toBe('application/octet-stream');
  });

  it('forwards description to requestBody', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'report.csv');

    await toolExecute(
      { filePath: localPath, description: 'Quarterly report' },
      { log: mockLog }
    );

    expect(filesCreate.mock.calls[0][0].requestBody.description).toBe('Quarterly report');
  });

  it('throws UserError when filePath is outside cwd', async () => {
    createMockDrive();

    await expect(
      toolExecute({ filePath: '/tmp/outside.csv' }, { log: mockLog })
    ).rejects.toThrow(UserError);
  });

  it('throws UserError when filePath does not exist', async () => {
    createMockDrive();
    mockExistsSync.mockReturnValue(false);
    const localPath = path.join(process.cwd(), 'missing.csv');

    await expect(toolExecute({ filePath: localPath }, { log: mockLog })).rejects.toThrow(
      /not found/
    );
  });

  it('maps Drive 404 to a folder-not-found UserError', async () => {
    const drive = { files: { create: vi.fn().mockRejectedValue({ code: 404 }) } };
    mockGetDriveClient.mockResolvedValue(drive as any);
    const localPath = path.join(process.cwd(), 'report.csv');

    await expect(
      toolExecute({ filePath: localPath, parentFolderId: 'bad' }, { log: mockLog })
    ).rejects.toThrow(/Parent folder not found/);
  });

  it('maps Drive 403 to a permission-denied UserError', async () => {
    const drive = { files: { create: vi.fn().mockRejectedValue({ code: 403 }) } };
    mockGetDriveClient.mockResolvedValue(drive as any);
    const localPath = path.join(process.cwd(), 'report.csv');

    await expect(toolExecute({ filePath: localPath }, { log: mockLog })).rejects.toThrow(
      /Permission denied/
    );
  });
});
