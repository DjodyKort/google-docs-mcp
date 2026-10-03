import { gmail_v1 } from 'googleapis';
import { UserError } from 'fastmcp';

export function findHeaderValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | null {
  if (!headers) return null;
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

const UNSAFE_HEADER_CHARS = /[\x00-\x08\x0A-\x1F\x7F\u0085\u2028\u2029]/;

/**
 * Rejects CR, LF and other control characters (tab is allowed) that would let a
 * caller-supplied value terminate a header line and inject further headers.
 */
export function assertSafeHeaderValue(name: string, value: string | null | undefined): void {
  if (value == null) return;
  if (UNSAFE_HEADER_CHARS.test(value)) {
    throw new UserError(`Invalid ${name}: control characters such as line breaks are not allowed.`);
  }
}

export function assertSafeHeaderValues(name: string, values: string[] | undefined): void {
  if (!values) return;
  for (const v of values) assertSafeHeaderValue(name, v);
}

export function encodeHeader(value: string): string {
  assertSafeHeaderValue('header value', value);
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  // RFC 2047 limits an encoded-word to 75 chars, so split on code point
  // boundaries (never mid UTF-8 sequence) and fold with CRLF + space.
  const words: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const ch of value) {
    const bytes = Buffer.byteLength(ch, 'utf-8');
    if (chunkBytes + bytes > 45) {
      words.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += ch;
    chunkBytes += bytes;
  }
  if (chunk) words.push(chunk);
  return words
    .map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf-8').toString('base64')}?=`)
    .join('\r\n ');
}

export interface MimeMessageOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}

export function buildMimeMessage(opts: MimeMessageOptions): string {
  assertSafeHeaderValues('To', opts.to);
  assertSafeHeaderValues('Cc', opts.cc);
  assertSafeHeaderValues('Bcc', opts.bcc);
  assertSafeHeaderValue('Subject', opts.subject);
  assertSafeHeaderValue('In-Reply-To', opts.inReplyTo);
  assertSafeHeaderValue('References', opts.references);
  const lines: string[] = [];
  lines.push(`To: ${opts.to.join(', ')}`);
  if (opts.cc && opts.cc.length > 0) lines.push(`Cc: ${opts.cc.join(', ')}`);
  if (opts.bcc && opts.bcc.length > 0) lines.push(`Bcc: ${opts.bcc.join(', ')}`);
  lines.push(`Subject: ${encodeHeader(opts.subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 8bit');
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push('');
  lines.push(opts.body);
  return lines.join('\r\n');
}

export function encodeRawMessage(mime: string): string {
  return Buffer.from(mime, 'utf-8').toString('base64url');
}

/**
 * Fetches the original message and returns the headers needed to build a
 * threaded reply (Message-Id for In-Reply-To, References chain, threadId).
 */
export async function getReplyContext(
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<{ threadId: string | undefined; inReplyTo: string | null; references: string | null }> {
  const original = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'metadata',
    metadataHeaders: ['Message-Id', 'References', 'Subject'],
  });
  const threadId = original.data.threadId ?? undefined;
  const origHeaders = original.data.payload?.headers;
  const inReplyTo = findHeaderValue(origHeaders, 'Message-Id');
  const origRefs = findHeaderValue(origHeaders, 'References');
  const references = [origRefs, inReplyTo].filter(Boolean).join(' ') || null;
  return { threadId, inReplyTo, references };
}

export interface DraftRequestArgs {
  to: string | string[];
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  replyToMessageId?: string;
}

/**
 * Resolves reply threading context (if any), builds the MIME message, and
 * returns the base64url-encoded raw + threadId ready for messages.send,
 * drafts.create, or drafts.update. Centralizes the compose pipeline so all
 * three call sites stay in sync on threading and MIME formatting.
 */
export async function prepareMimeRequest(
  gmail: gmail_v1.Gmail,
  args: DraftRequestArgs
): Promise<{ raw: string; threadId: string | undefined; toList: string[] }> {
  const toList = Array.isArray(args.to) ? args.to : [args.to];
  assertSafeHeaderValues('To', toList);
  assertSafeHeaderValues('Cc', args.cc);
  assertSafeHeaderValues('Bcc', args.bcc);
  assertSafeHeaderValue('Subject', args.subject);
  let threadId: string | undefined;
  let inReplyTo: string | null = null;
  let references: string | null = null;

  if (args.replyToMessageId) {
    const ctx = await getReplyContext(gmail, args.replyToMessageId);
    threadId = ctx.threadId;
    inReplyTo = ctx.inReplyTo;
    references = ctx.references;
  }

  const raw = encodeRawMessage(
    buildMimeMessage({
      to: toList,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
      inReplyTo,
      references,
    })
  );

  return { raw, threadId, toList };
}

export function decodeBase64Url(data?: string | null): string {
  if (!data) return '';
  return Buffer.from(data, 'base64url').toString('utf-8');
}

/**
 * Walks a Gmail message payload tree and accumulates all text/plain and
 * text/html parts. Returns both representations so callers can pick the
 * one they want (text for processing, html for display).
 */
export function extractMessageBody(payload?: gmail_v1.Schema$MessagePart): {
  text: string;
  html: string;
} {
  let text = '';
  let html = '';
  if (!payload) return { text, html };
  const walk = (part: gmail_v1.Schema$MessagePart) => {
    const mime = part.mimeType ?? '';
    if (mime === 'text/plain' && part.body?.data) text += decodeBase64Url(part.body.data);
    else if (mime === 'text/html' && part.body?.data) html += decodeBase64Url(part.body.data);
    if (part.parts) for (const sub of part.parts) walk(sub);
  };
  walk(payload);
  return { text, html };
}

export function extractDomain(fromHeader: string | null): string | null {
  if (!fromHeader) return null;
  const match = fromHeader.match(/<?([^@<>\s]+)@([^>\s]+)>?/);
  return match ? match[2].toLowerCase() : null;
}
