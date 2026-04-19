import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../clients.js', () => ({
  getDriveClient: vi.fn(),
}));

import { getDriveClient } from '../../clients.js';
import { register } from './listSupportedConversions.js';

const mockGetDriveClient = vi.mocked(getDriveClient);

let toolExecute: (args: any, context: any) => Promise<string>;
const mockLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

const FIXTURE_IMPORT_FORMATS = {
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    'application/vnd.google-apps.spreadsheet',
  ],
  'text/csv': ['application/vnd.google-apps.spreadsheet'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    'application/vnd.google-apps.document',
  ],
  'image/png': [
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.drawing',
  ],
};

function buildDrive() {
  const aboutGet = vi
    .fn()
    .mockResolvedValue({ data: { importFormats: FIXTURE_IMPORT_FORMATS } });
  const drive = { about: { get: aboutGet } };
  mockGetDriveClient.mockResolvedValue(drive as any);
  return { drive, aboutGet };
}

describe('listSupportedConversions integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fakeServer = { addTool: (cfg: any) => (toolExecute = cfg.execute) };
    register(fakeServer as any);
  });

  it('calls about.get with fields=importFormats', async () => {
    const { aboutGet } = buildDrive();

    await toolExecute({}, { log: mockLog });

    expect(aboutGet).toHaveBeenCalledWith({ fields: 'importFormats' });
  });

  it('returns all entries with extension enrichment when no filters are given', async () => {
    buildDrive();

    const result = await toolExecute({}, { log: mockLog });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(4);
    const bySource = Object.fromEntries(
      parsed.entries.map((e: any) => [e.sourceMime, e])
    );

    expect(bySource['text/csv'].extensions).toEqual(['.csv']);
    expect(
      bySource['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].extensions
    ).toEqual(['.xlsx']);
    expect(
      bySource['application/vnd.openxmlformats-officedocument.wordprocessingml.document'].extensions
    ).toEqual(['.docx']);
    expect(bySource['image/png'].extensions).toEqual(['.png']);
  });

  it('filters by sourceMimeType', async () => {
    buildDrive();

    const result = await toolExecute({ sourceMimeType: 'text/csv' }, { log: mockLog });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.entries[0].sourceMime).toBe('text/csv');
  });

  it('filters by targetType=spreadsheet (keeps only sources that produce a Sheet)', async () => {
    buildDrive();

    const result = await toolExecute({ targetType: 'spreadsheet' }, { log: mockLog });
    const parsed = JSON.parse(result);

    const sources = parsed.entries.map((e: any) => e.sourceMime).sort();
    expect(sources).toEqual([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ]);
  });

  it('filters by targetType=document (PNG appears because it can convert to a Doc via OCR)', async () => {
    buildDrive();

    const result = await toolExecute({ targetType: 'document' }, { log: mockLog });
    const parsed = JSON.parse(result);

    const sources = parsed.entries.map((e: any) => e.sourceMime).sort();
    expect(sources).toEqual([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
    ]);
  });

  it('filters by targetType=drawing', async () => {
    buildDrive();

    const result = await toolExecute({ targetType: 'drawing' }, { log: mockLog });
    const parsed = JSON.parse(result);

    const sources = parsed.entries.map((e: any) => e.sourceMime);
    expect(sources).toEqual(['image/png']);
  });

  it('combining source and target filters narrows correctly', async () => {
    buildDrive();

    const result = await toolExecute(
      { sourceMimeType: 'image/png', targetType: 'spreadsheet' },
      { log: mockLog }
    );
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(0);
  });

  it('echoes the applied filters back in the response', async () => {
    buildDrive();

    const result = await toolExecute(
      { sourceMimeType: 'text/csv', targetType: 'spreadsheet' },
      { log: mockLog }
    );
    const parsed = JSON.parse(result);

    expect(parsed.filters).toEqual({
      sourceMimeType: 'text/csv',
      targetType: 'spreadsheet',
    });
  });

  it('returns an empty entries array (not an error) when Drive returns no importFormats', async () => {
    const aboutGet = vi.fn().mockResolvedValue({ data: {} });
    mockGetDriveClient.mockResolvedValue({ about: { get: aboutGet } } as any);

    const result = await toolExecute({}, { log: mockLog });
    const parsed = JSON.parse(result);

    expect(parsed.count).toBe(0);
    expect(parsed.entries).toEqual([]);
  });
});
