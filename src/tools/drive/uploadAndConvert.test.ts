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
import { register } from './uploadAndConvert.js';
import { UserError } from 'fastmcp';

const mockGetDriveClient = vi.mocked(getDriveClient);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockCreateReadStream = vi.mocked(fs.createReadStream);

let toolExecute: (args: any, context: any) => Promise<string>;
const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

function createMockDrive(responseOverrides: Record<string, any> = {}) {
  const filesCreate = vi.fn().mockResolvedValue({
    data: {
      id: 'converted-id',
      name: 'converted',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      webViewLink: 'https://docs.google.com/spreadsheets/d/converted-id',
      ...responseOverrides,
    },
  });
  const drive = { files: { create: filesCreate } };
  mockGetDriveClient.mockResolvedValue(drive as any);
  return { drive, filesCreate };
}

describe('uploadAndConvert integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockCreateReadStream.mockReturnValue('mock-read-stream' as any);
    const fakeServer = { addTool: (cfg: any) => (toolExecute = cfg.execute) };
    register(fakeServer as any);
  });

  it('auto-detects xlsx → spreadsheet, keeps source MIME on media, strips extension for default name', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'Q4.xlsx');

    const result = await toolExecute({ filePath: localPath }, { log: mockLog });

    const call = filesCreate.mock.calls[0][0];
    expect(call.requestBody.mimeType).toBe('application/vnd.google-apps.spreadsheet');
    expect(call.requestBody.name).toBe('Q4');
    expect(call.media.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(call.media.body).toBe('mock-read-stream');
    expect(call.supportsAllDrives).toBe(true);

    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('converted-id');
    expect(parsed.convertedFrom).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  });

  it.each([
    ['.docx', 'document', 'application/vnd.google-apps.document'],
    ['.pptx', 'presentation', 'application/vnd.google-apps.presentation'],
    ['.odt', 'document', 'application/vnd.google-apps.document'],
    ['.csv', 'spreadsheet', 'application/vnd.google-apps.spreadsheet'],
  ])('auto-detects %s → %s', async (ext, _short, targetMime) => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), `file${ext}`);

    await toolExecute({ filePath: localPath }, { log: mockLog });

    expect(filesCreate.mock.calls[0][0].requestBody.mimeType).toBe(targetMime);
  });

  it('explicit convertTo overrides auto-detection', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'Q4.xlsx');

    await toolExecute(
      { filePath: localPath, convertTo: 'document' },
      { log: mockLog }
    );

    expect(filesCreate.mock.calls[0][0].requestBody.mimeType).toBe(
      'application/vnd.google-apps.document'
    );
  });

  it('forwards ocrLanguage to files.create', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'scan.png');

    await toolExecute(
      { filePath: localPath, convertTo: 'document', ocrLanguage: 'en' },
      { log: mockLog }
    );

    expect(filesCreate.mock.calls[0][0].ocrLanguage).toBe('en');
  });

  it('omits ocrLanguage when not provided', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'Q4.xlsx');

    await toolExecute({ filePath: localPath }, { log: mockLog });

    expect(filesCreate.mock.calls[0][0].ocrLanguage).toBeUndefined();
  });

  it('forwards parentFolderId as requestBody.parents', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'Q4.xlsx');

    await toolExecute(
      { filePath: localPath, parentFolderId: 'folder-1' },
      { log: mockLog }
    );

    expect(filesCreate.mock.calls[0][0].requestBody.parents).toEqual(['folder-1']);
  });

  it('uses custom name when supplied', async () => {
    const { filesCreate } = createMockDrive();
    const localPath = path.join(process.cwd(), 'Q4.xlsx');

    await toolExecute(
      { filePath: localPath, name: 'My Budget' },
      { log: mockLog }
    );

    expect(filesCreate.mock.calls[0][0].requestBody.name).toBe('My Budget');
  });

  it('auto with an ambiguous source (.pdf) throws UserError asking for explicit convertTo', async () => {
    createMockDrive();
    const localPath = path.join(process.cwd(), 'mystery.pdf');

    await expect(toolExecute({ filePath: localPath }, { log: mockLog })).rejects.toThrow(
      /Cannot auto-detect/
    );
  });

  it('maps Drive 400 to a clear source→target mismatch UserError', async () => {
    const drive = { files: { create: vi.fn().mockRejectedValue({ code: 400 }) } };
    mockGetDriveClient.mockResolvedValue(drive as any);
    const localPath = path.join(process.cwd(), 'pic.png');

    await expect(
      toolExecute({ filePath: localPath, convertTo: 'spreadsheet' }, { log: mockLog })
    ).rejects.toThrow(/Drive rejected the conversion/);
  });

  it('throws UserError when filePath is outside cwd', async () => {
    createMockDrive();

    await expect(
      toolExecute({ filePath: '/tmp/outside.xlsx' }, { log: mockLog })
    ).rejects.toThrow(UserError);
  });
});
