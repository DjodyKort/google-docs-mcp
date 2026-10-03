import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserError } from 'fastmcp';

const gmail = {
  users: {
    messages: {
      send: vi.fn().mockResolvedValue({ data: { id: 'm1', threadId: 't1' } }),
      get: vi.fn().mockResolvedValue({ data: { threadId: 't1', payload: { headers: [] } } }),
    },
    drafts: {
      create: vi.fn().mockResolvedValue({ data: { id: 'd1', message: { id: 'm1' } } }),
      update: vi.fn().mockResolvedValue({ data: { id: 'd1', message: { id: 'm1' } } }),
    },
  },
};

vi.mock('../../clients.js', () => ({ getGmailClient: vi.fn(async () => gmail) }));

import { register as registerSend } from './sendEmail.js';
import { register as registerCreate } from './createDraft.js';
import { register as registerUpdate } from './updateDraft.js';
import { encodeHeader, buildMimeMessage, assertSafeHeaderValue } from './helpers.js';

function load(register: (s: any) => void): (args: any, ctx: any) => Promise<string> {
  let exec: any;
  register({ addTool: (c: any) => (exec = c.execute) });
  return exec;
}

const ctx = { log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } };

const tools: Array<[string, (a: any, c: any) => Promise<string>, Record<string, unknown>]> = [
  ['sendEmail', load(registerSend), {}],
  ['createDraft', load(registerCreate), {}],
  ['updateDraft', load(registerUpdate), { draftId: 'd1' }],
];

const base = { to: 'a@example.com', subject: 'hi', body: 'body' };
const evil = [
  'x\r\nBcc: evil@example.com',
  'x\nBcc: evil@example.com',
  'x\rBcc: e',
  'x\x00y',
  'x\x1by',
];

beforeEach(() => vi.clearAllMocks());

describe.each(tools)('%s header injection', (_name, exec, extra) => {
  it('accepts clean input', async () => {
    await expect(exec({ ...base, ...extra }, ctx)).resolves.toBeTypeOf('string');
  });

  const cases: Array<[string, (v: string) => any]> = [
    ['to (string)', (v) => ({ to: v })],
    ['to (array)', (v) => ({ to: ['ok@example.com', v] })],
    ['cc', (v) => ({ cc: [v] })],
    ['bcc', (v) => ({ bcc: [v] })],
    ['subject', (v) => ({ subject: v })],
  ];

  for (const [field, mk] of cases) {
    it.each(evil)(`rejects control chars in ${field}: %j`, async (v) => {
      const p = exec({ ...base, ...extra, ...mk(v) }, ctx);
      await expect(p).rejects.toBeInstanceOf(UserError);
      expect(gmail.users.messages.send).not.toHaveBeenCalled();
      expect(gmail.users.drafts.create).not.toHaveBeenCalled();
      expect(gmail.users.drafts.update).not.toHaveBeenCalled();
      expect(gmail.users.messages.get).not.toHaveBeenCalled();
    });
  }
});

describe('buildMimeMessage guards', () => {
  it('rejects CR/LF in In-Reply-To and References', () => {
    const o = { to: ['a@example.com'], subject: 's', body: 'b' };
    expect(() => buildMimeMessage({ ...o, inReplyTo: '<a>\r\nX: y' })).toThrow(UserError);
    expect(() => buildMimeMessage({ ...o, references: '<a>\nX: y' })).toThrow(UserError);
  });

  it('exposes a generic guard for from/reply-to/filename/MIME type values', () => {
    for (const name of ['From', 'Reply-To', 'filename', 'Content-Type']) {
      expect(() => assertSafeHeaderValue(name, 'a\r\nb')).toThrow(UserError);
    }
    expect(() => assertSafeHeaderValue('From', 'A <a@example.com>')).not.toThrow();
    expect(() => assertSafeHeaderValue('From', undefined)).not.toThrow();
  });
});

describe('encodeHeader', () => {
  it('passes ASCII through', () => {
    expect(encodeHeader('hello')).toBe('hello');
  });

  it('encodes non-ASCII as RFC 2047 words that round-trip and stay <= 75 chars', () => {
    const subject = 'Überprüfung ✓ '.repeat(12) + '日本語😀';
    const enc = encodeHeader(subject);
    const words = enc.split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      expect(w).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    }
    const decoded = words
      .map((w) => Buffer.from(w.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf-8'))
      .join('');
    expect(decoded).toBe(subject);
  });

  it('rejects line breaks even in non-ASCII subjects', () => {
    expect(() => encodeHeader('é\r\nBcc: x')).toThrow(UserError);
  });
});
