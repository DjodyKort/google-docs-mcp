import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserError } from 'fastmcp';

vi.mock('../../clients.js', () => ({
  getDocsClient: vi.fn(),
}));

vi.mock('../../markdown-transformer/markdownToDocs.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../markdown-transformer/markdownToDocs.js')>();
  return { ...actual, convertMarkdownToRequests: vi.fn(actual.convertMarkdownToRequests) };
});

import { getDocsClient } from '../../clients.js';
import { convertMarkdownToRequests } from '../../markdown-transformer/markdownToDocs.js';
import { MarkdownConversionError } from '../../types.js';
import { register } from './replaceDocumentWithMarkdown.js';

let execute: (args: any, ctx: any) => Promise<string>;
register({ addTool: (c: any) => (execute = c.execute) } as any);

const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
const args = {
  documentId: 'doc1',
  markdown: '# Title\n\nHello **world**',
  preserveTitle: false,
  firstHeadingAsTitle: true,
};

function makeDocs() {
  return {
    documents: {
      get: vi.fn().mockResolvedValue({
        data: {
          revisionId: 'rev-42',
          body: {
            content: [
              { startIndex: 0, endIndex: 1 },
              { startIndex: 1, endIndex: 30 },
            ],
          },
        },
      }),
      batchUpdate: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
}

describe('replaceDocumentWithMarkdown', () => {
  let docs: ReturnType<typeof makeDocs>;

  beforeEach(() => {
    vi.clearAllMocks();
    docs = makeDocs();
    vi.mocked(getDocsClient).mockResolvedValue(docs as any);
  });

  it('makes no API write when conversion fails', async () => {
    vi.mocked(convertMarkdownToRequests).mockImplementationOnce(() => {
      throw new MarkdownConversionError('boom');
    });

    await expect(execute(args, { log })).rejects.toBeInstanceOf(MarkdownConversionError);
    expect(docs.documents.batchUpdate).not.toHaveBeenCalled();
  });

  it('refuses to clear the document when markdown yields no content', async () => {
    vi.mocked(convertMarkdownToRequests).mockReturnValueOnce([]);

    await expect(execute(args, { log })).rejects.toBeInstanceOf(UserError);
    expect(docs.documents.batchUpdate).not.toHaveBeenCalled();
  });

  it('sends delete and insert in one batchUpdate pinned to the fetched revision', async () => {
    await execute(args, { log });

    expect(docs.documents.batchUpdate).toHaveBeenCalledTimes(1);
    const call = docs.documents.batchUpdate.mock.calls[0][0];
    expect(call.documentId).toBe('doc1');
    expect(call.requestBody.writeControl).toEqual({ requiredRevisionId: 'rev-42' });
    const types = call.requestBody.requests.map((r: any) => Object.keys(r)[0]);
    expect(types[0]).toBe('deleteContentRange');
    expect(call.requestBody.requests[0].deleteContentRange.range).toEqual({
      startIndex: 1,
      endIndex: 29,
    });
    expect(types).toContain('insertText');
    expect(types.indexOf('deleteContentRange')).toBeLessThan(types.indexOf('insertText'));
  });

  it('reports a revision conflict as a UserError and does not retry', async () => {
    docs.documents.batchUpdate.mockRejectedValue(
      Object.assign(new Error('The required revision ID does not match the latest revision'), {
        code: 400,
      })
    );

    const err = await execute(args, { log }).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toMatch(/revision mismatch/);
    expect(docs.documents.batchUpdate).toHaveBeenCalledTimes(1);
  });

  it('refuses to write when the revision cannot be read', async () => {
    docs.documents.get.mockResolvedValue({
      data: { body: { content: [{ startIndex: 0, endIndex: 5 }] } },
    });

    await expect(execute(args, { log })).rejects.toBeInstanceOf(UserError);
    expect(docs.documents.batchUpdate).not.toHaveBeenCalled();
  });
});
