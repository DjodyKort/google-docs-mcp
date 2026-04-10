import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getGmailClient } from '../../clients.js';
import { findHeaderValue } from './helpers.js';

function encodeHeader(value: string): string {
  // RFC 2047 encoded-word for any non-ASCII content in headers.
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function buildMimeMessage(opts: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
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

export function register(server: FastMCP) {
  server.addTool({
    name: 'sendEmail',
    description:
      'Sends a plain-text email from the authenticated Gmail account. Supports cc/bcc and optional threading by passing replyToMessageId (which copies threadId and sets In-Reply-To/References so the reply lands in the same thread).',
    parameters: z.object({
      to: z
        .union([z.string(), z.array(z.string()).min(1)])
        .describe('Recipient email address, or an array of recipient email addresses.'),
      subject: z.string().describe('Email subject line.'),
      body: z.string().describe('Plain-text body of the email.'),
      cc: z.array(z.string()).optional().describe('Optional list of Cc recipients.'),
      bcc: z.array(z.string()).optional().describe('Optional list of Bcc recipients.'),
      replyToMessageId: z
        .string()
        .optional()
        .describe(
          'Optional Gmail message ID to reply to. When set, the new email is threaded with the original and uses In-Reply-To/References headers.'
        ),
    }),
    execute: async (args, { log }) => {
      const gmail = await getGmailClient();
      const toList = Array.isArray(args.to) ? args.to : [args.to];
      log.info(
        `Sending Gmail message to ${toList.join(', ')}${
          args.replyToMessageId ? ` (reply to ${args.replyToMessageId})` : ''
        }`
      );

      try {
        let threadId: string | undefined;
        let inReplyTo: string | null = null;
        let references: string | null = null;

        if (args.replyToMessageId) {
          const original = await gmail.users.messages.get({
            userId: 'me',
            id: args.replyToMessageId,
            format: 'metadata',
            metadataHeaders: ['Message-Id', 'References', 'Subject'],
          });
          threadId = original.data.threadId ?? undefined;
          const origHeaders = original.data.payload?.headers;
          inReplyTo = findHeaderValue(origHeaders, 'Message-Id');
          const origRefs = findHeaderValue(origHeaders, 'References');
          references = [origRefs, inReplyTo].filter(Boolean).join(' ') || null;
        }

        const mime = buildMimeMessage({
          to: toList,
          cc: args.cc,
          bcc: args.bcc,
          subject: args.subject,
          body: args.body,
          inReplyTo,
          references,
        });
        const raw = Buffer.from(mime, 'utf-8').toString('base64url');

        const send = await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw,
            ...(threadId ? { threadId } : {}),
          },
        });

        return JSON.stringify(
          {
            success: true,
            id: send.data.id,
            threadId: send.data.threadId,
            labelIds: send.data.labelIds ?? [],
            to: toList,
            subject: args.subject,
            message: `Email sent to ${toList.join(', ')}.`,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error sending Gmail message: ${error.message || error}`);
        if (error.code === 401)
          throw new UserError(
            'Gmail authorization failed. Re-authorize to grant the gmail.modify scope.'
          );
        if (error.code === 403)
          throw new UserError(
            'Permission denied. The account does not have permission to send mail via this OAuth client.'
          );
        if (error.code === 400)
          throw new UserError(`Gmail rejected the message: ${error.message || 'Bad request'}`);
        throw new UserError(`Failed to send email: ${error.message || 'Unknown error'}`);
      }
    },
  });
}
