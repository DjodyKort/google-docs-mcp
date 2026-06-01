import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { google } from 'googleapis';
import { getAuthClient, getSheetsClient } from '../../../clients.js';

const CreateSheetsCommentParameters = z
  .object({
    spreadsheetId: z
      .string()
      .describe(
        'The spreadsheet ID — the long string between /d/ and /edit in a Google Sheets URL.'
      ),
    content: z.string().min(1).describe('The text content of the comment.'),
    sheetName: z
      .string()
      .optional()
      .describe(
        'Optional sheet/tab name for cell or range anchors that do not already include a sheet prefix.'
      ),
    cell: z
      .string()
      .optional()
      .describe(
        'Optional target cell in A1 notation (for example "B3" or "Sheet1!B3"). Creates an anchored comment request for that cell.'
      ),
    range: z
      .string()
      .optional()
      .describe(
        'Optional target range in A1 notation (for example "B3:D5" or "Sheet1!B3:D5"). The anchor uses the top-left cell of the range.'
      ),
    includeCellLink: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'If true, appends a direct Google Sheets URL with gid and range to the comment content so users can click through to the target cell/range even when the Sheets UI treats API-created comments as unanchored.'
      ),
  })
  .refine((data) => !(data.cell && data.range), {
    message: 'Provide either cell or range, not both.',
    path: ['range'],
  })
  .refine(
    (data) => {
      if (!data.cell && !data.range) {
        return true;
      }
      if (data.sheetName) {
        return true;
      }
      return hasSheetPrefix(data.cell ?? data.range ?? '');
    },
    {
      message: 'sheetName is required when cell or range does not include a sheet prefix.',
      path: ['sheetName'],
    }
  );

export function register(server: FastMCP) {
  server.addTool({
    name: 'createSheetsComment',
    description:
      'Creates a new comment in a Google Spreadsheet. You can optionally target a specific cell or range, but Google Sheets UI may still display API-created comments as unanchored due to a Drive API limitation.',
    parameters: CreateSheetsCommentParameters,
    execute: async (args, { log }) => {
      log.info(`Creating spreadsheet comment in ${args.spreadsheetId}`);

      try {
        const authClient = await getAuthClient();
        const drive = google.drive({ version: 'v3', auth: authClient });
        const sheets = await getSheetsClient();

        let anchor: string | undefined;
        let quotedText: string | undefined;
        let locationLabel: string | undefined;
        let cellUrl: string | undefined;

        if (args.cell || args.range) {
          const parsedLocation = parseLocation(args.cell ?? args.range ?? '', args.sheetName);
          const sheetId = await resolveSheetId(
            sheets,
            args.spreadsheetId,
            parsedLocation.sheetName
          );

          anchor = JSON.stringify({
            r: 'head',
            a: [
              {
                sht: {
                  sid: sheetId,
                  rng: {
                    r: parsedLocation.row,
                    c: parsedLocation.col,
                  },
                },
              },
            ],
          });

          quotedText = await readRangeText(
            sheets,
            args.spreadsheetId,
            `${quoteSheetName(parsedLocation.sheetName)}!${parsedLocation.a1Range}`
          );
          locationLabel = `${parsedLocation.sheetName}!${parsedLocation.a1Range}`;
          cellUrl = buildCellUrl(args.spreadsheetId, sheetId, parsedLocation.a1Range);
        }

        const content =
          args.includeCellLink && cellUrl
            ? `${args.content}\n\nCell link: ${cellUrl}`
            : args.content;

        const response = await drive.comments.create({
          fileId: args.spreadsheetId,
          fields: 'id,anchor,quotedFileContent,createdTime',
          requestBody: {
            content,
            ...(anchor ? { anchor } : {}),
            ...(quotedText
              ? {
                  quotedFileContent: {
                    value: quotedText,
                    mimeType: 'text/plain',
                  },
                }
              : {}),
          },
        });

        const locationNote = locationLabel ? ` Requested anchor: ${locationLabel}.` : '';
        return (
          `Comment added successfully. Comment ID: ${response.data.id}.` +
          locationNote +
          ' Note: Google Sheets UI may still show API-created spreadsheet comments as unanchored.'
        );
      } catch (error: any) {
        log.error(`Error creating sheets comment: ${error.message || error}`);
        const errorDetails =
          error.response?.data?.error?.message || error.message || 'Unknown error';
        throw new UserError(`Failed to create spreadsheet comment: ${errorDetails}`);
      }
    },
  });
}

function buildCellUrl(spreadsheetId: string, sheetId: number, a1Range: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}&range=${encodeURIComponent(a1Range)}`;
}

function hasSheetPrefix(value: string): boolean {
  return value.includes('!');
}

function parseLocation(
  value: string,
  fallbackSheetName?: string
): { sheetName: string; a1Range: string; row: number; col: number } {
  const bangIndex = value.lastIndexOf('!');
  const rawSheetName =
    bangIndex >= 0 ? unquoteSheetName(value.slice(0, bangIndex)) : fallbackSheetName;
  const a1Range = bangIndex >= 0 ? value.slice(bangIndex + 1) : value;

  if (!rawSheetName) {
    throw new UserError('Could not determine the target sheet name for the spreadsheet comment.');
  }

  const startCell = a1Range.split(':')[0];
  const { row, col } = a1ToRowCol(startCell);

  return {
    sheetName: rawSheetName,
    a1Range,
    row,
    col,
  };
}

function a1ToRowCol(a1: string): { row: number; col: number } {
  const match = a1.trim().match(/^([A-Za-z]+)(\d+)$/);
  if (!match) {
    throw new UserError(`Invalid A1 cell reference: ${a1}`);
  }

  const colStr = match[1].toUpperCase();
  let col = 0;

  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }

  return {
    row: parseInt(match[2], 10) - 1,
    col: col - 1,
  };
}

function unquoteSheetName(sheetName: string): string {
  const trimmed = sheetName.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

async function resolveSheetId(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  spreadsheetId: string,
  sheetName: string
): Promise<number> {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(sheetId,title)',
  });

  for (const sheet of response.data.sheets || []) {
    const props = sheet.properties;
    if (props?.title === sheetName && props.sheetId != null) {
      return props.sheetId;
    }
  }

  throw new UserError(`Sheet "${sheetName}" was not found in spreadsheet ${spreadsheetId}.`);
}

async function readRangeText(
  sheets: Awaited<ReturnType<typeof getSheetsClient>>,
  spreadsheetId: string,
  range: string
): Promise<string | undefined> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const values = response.data.values || [];
  if (values.length === 0) {
    return undefined;
  }

  const lines = values
    .map((row) =>
      row
        .map((cell) => String(cell))
        .join('\t')
        .trimEnd()
    )
    .filter((line) => line.length > 0);

  return lines.length > 0 ? lines.join('\n') : undefined;
}
