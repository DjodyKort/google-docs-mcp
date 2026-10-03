import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const drive = {
  files: { get: vi.fn(), create: vi.fn() },
  permissions: { create: vi.fn(), delete: vi.fn() },
};

vi.mock('../../clients.js', () => ({
  getDocsClient: vi.fn(async () => ({})),
  getDriveClient: vi.fn(async () => drive),
  getScriptClient: vi.fn(async () => ({})),
}));

vi.mock('../../googleDocsApiHelpers.js', async (orig) => {
  const actual = await orig<typeof import('../../googleDocsApiHelpers.js')>();
  return { ...actual, insertInlineImage: vi.fn() };
});

import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { register } from './insertImage.js';
import { logger } from '../../logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let exec: (args: any, ctx: any) => Promise<string>;
register({ addTool: (c: any) => (exec = c.execute) } as any);
const ctx = { log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } };

let imgPath: string;
const args = () => ({ documentId: 'doc1', localImagePath: imgPath, index: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.imgtest-'));
  imgPath = path.join(dir, 'a.png');
  fs.writeFileSync(imgPath, 'fake');
  drive.files.get.mockImplementation(async ({ fields }: any) =>
    fields === 'parents'
      ? { data: { parents: ['p1'] } }
      : { data: { webContentLink: 'https://x/y' } }
  );
  drive.files.create.mockImplementation(async ({ media }: any) => {
    await new Promise((resolve) => {
      media.body.on('close', resolve);
      media.body.resume();
    });
    return { data: { id: 'file1' } };
  });
  drive.permissions.create.mockResolvedValue({ data: { id: 'perm1' } });
  drive.permissions.delete.mockResolvedValue({});
  vi.mocked(GDocsHelpers.insertInlineImage).mockResolvedValue(undefined as any);
});

afterEach(() => {
  for (const d of fs.readdirSync(process.cwd()).filter((n) => n.startsWith('.imgtest-')))
    fs.rmSync(path.join(process.cwd(), d), { recursive: true, force: true });
});

describe('insertImage temporary public sharing', () => {
  it('revokes the anyone/reader permission after success', async () => {
    await exec(args(), ctx);
    expect(drive.permissions.create).toHaveBeenCalledTimes(1);
    expect(drive.permissions.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file1', permissionId: 'perm1' })
    );
  });

  it('revokes after the Docs insert fails and surfaces the original error', async () => {
    vi.mocked(GDocsHelpers.insertInlineImage).mockRejectedValue(new Error('docs boom'));
    await expect(exec(args(), ctx)).rejects.toThrow(/docs boom/);
    expect(drive.permissions.delete).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'file1', permissionId: 'perm1' })
    );
  });

  it('revokes when fetching the public URL fails after sharing', async () => {
    drive.files.get.mockImplementation(async ({ fields }: any) =>
      fields === 'parents' ? { data: {} } : { data: {} }
    );
    await expect(exec(args(), ctx)).rejects.toThrow(/public URL/);
    expect(drive.permissions.delete).toHaveBeenCalledTimes(1);
  });

  it('does not fail the tool when permission deletion fails, and warns', async () => {
    drive.permissions.delete.mockRejectedValue(new Error('delete boom'));
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(exec(args(), ctx)).resolves.toMatch(/Successfully inserted image/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('perm1'));
  });

  it('keeps the original error when both insert and revoke fail', async () => {
    vi.mocked(GDocsHelpers.insertInlineImage).mockRejectedValue(new Error('docs boom'));
    drive.permissions.delete.mockRejectedValue(new Error('delete boom'));
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(exec(args(), ctx)).rejects.toThrow(/docs boom/);
  });

  it('does not touch permissions for a plain imageUrl', async () => {
    await exec({ documentId: 'doc1', imageUrl: 'https://example.com/a.png', index: 1 }, ctx);
    expect(drive.permissions.create).not.toHaveBeenCalled();
    expect(drive.permissions.delete).not.toHaveBeenCalled();
  });
});
