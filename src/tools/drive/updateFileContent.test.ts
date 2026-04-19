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
import { register } from './updateFileContent.js';
import { UserError } from 'fastmcp';

const mockGetDriveClient = vi.mocked(getDriveClient);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockCreateReadStream = vi.mocked(fs.createReadStream);

let toolExecute: (args: any, context: any) => Promise<string>;
const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

function buildDrive(responseOverrides: Record<string, any> = {}, rejects?: any) {
  const filesUpdate = rejects
    ? vi.fn().mockRejectedValue(rejects)
    : vi.fn().mockResolvedValue({
        data: {
          id: 'target-id',
          name: 'report.csv',
          mimeType: 'text/csv',
          version: '42',
          modifiedTime: '2026-04-19T12:00:00.000Z',
          ...responseOverrides,
        },
      });
  const drive = { files: { update: filesUpdate } };
  mockGetDriveClient.mockResolvedValue(drive as any);
  return { drive, filesUpdate };
}

describe('updateFileContent integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockCreateReadStream.mockReturnValue('mock-read-stream' as any);
    const fakeServer = { addTool: (cfg: any) => (toolExecute = cfg.execute) };
    register(fakeServer as any);
  });

  it('calls files.update with inferred mimeType from local extension', async () => {
    const { filesUpdate } = buildDrive();
    const localPath = path.join(process.cwd(), 'report.csv');

    const result = await toolExecute(
      { fileId: 'target-id', filePath: localPath },
      { log: mockLog }
    );

    const call = filesUpdate.mock.calls[0][0];
    expect(call.fileId).toBe('target-id');
    expect(call.media.mimeType).toBe('text/csv');
    expect(call.media.body).toBe('mock-read-stream');
    expect(call.supportsAllDrives).toBe(true);
    expect(call.keepRevisionForever).toBeUndefined();
    expect(mockCreateReadStream).toHaveBeenCalledWith(path.resolve(localPath));

    const parsed = JSON.parse(result);
    expect(parsed).toEqual({
      id: 'target-id',
      name: 'report.csv',
      mimeType: 'text/csv',
      version: '42',
      modifiedTime: '2026-04-19T12:00:00.000Z',
    });
  });

  it('mimeType override replaces inferred media MIME', async () => {
    const { filesUpdate } = buildDrive();
    const localPath = path.join(process.cwd(), 'weird.bin');

    await toolExecute(
      { fileId: 'target-id', filePath: localPath, mimeType: 'application/pdf' },
      { log: mockLog }
    );

    expect(filesUpdate.mock.calls[0][0].media.mimeType).toBe('application/pdf');
  });

  it('keepRevision=true sets keepRevisionForever on the update call', async () => {
    const { filesUpdate } = buildDrive();
    const localPath = path.join(process.cwd(), 'report.csv');

    await toolExecute(
      { fileId: 'target-id', filePath: localPath, keepRevision: true },
      { log: mockLog }
    );

    expect(filesUpdate.mock.calls[0][0].keepRevisionForever).toBe(true);
  });

  it('throws UserError when filePath is outside cwd', async () => {
    buildDrive();

    await expect(
      toolExecute(
        { fileId: 'target-id', filePath: '/tmp/outside.csv' },
        { log: mockLog }
      )
    ).rejects.toThrow(UserError);
  });

  it('throws UserError when filePath does not exist', async () => {
    buildDrive();
    mockExistsSync.mockReturnValue(false);
    const localPath = path.join(process.cwd(), 'gone.csv');

    await expect(
      toolExecute({ fileId: 'target-id', filePath: localPath }, { log: mockLog })
    ).rejects.toThrow(/not found/);
  });

  it('maps Drive 404 to "File not found" UserError', async () => {
    buildDrive({}, { code: 404 });
    const localPath = path.join(process.cwd(), 'report.csv');

    await expect(
      toolExecute({ fileId: 'missing', filePath: localPath }, { log: mockLog })
    ).rejects.toThrow(/File not found/);
  });

  it('maps Drive 403 to a permission-denied UserError', async () => {
    buildDrive({}, { code: 403 });
    const localPath = path.join(process.cwd(), 'report.csv');

    await expect(
      toolExecute({ fileId: 'locked', filePath: localPath }, { log: mockLog })
    ).rejects.toThrow(/Permission denied/);
  });
});
