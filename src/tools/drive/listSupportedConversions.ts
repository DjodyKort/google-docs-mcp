import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDriveClient } from '../../clients.js';
import {
  GOOGLE_TYPE_MAP,
  GoogleTargetShort,
  extensionsForMime,
} from './uploadHelpers.js';

interface ConversionEntry {
  sourceMime: string;
  extensions: string[];
  targets: string[];
}

export function register(server: FastMCP) {
  server.addTool({
    name: 'listSupportedConversions',
    description:
      'Lists the source→target conversions Drive currently accepts for the authenticated user, ' +
      'from `about.importFormats`. Use this to discover which local file types `uploadAndConvert` ' +
      'and `convertFile` can accept, and which Google Workspace targets they can produce. ' +
      'Filter by source MIME or by target short name (document/spreadsheet/presentation/drawing).',
    parameters: z.object({
      sourceMimeType: z
        .string()
        .optional()
        .describe('Filter results to a single source MIME (e.g. "text/csv").'),
      targetType: z
        .enum(['document', 'spreadsheet', 'presentation', 'drawing'])
        .optional()
        .describe('Filter to sources that can convert to this Google Workspace target.'),
    }),
    execute: async (args, { log }) => {
      const drive = await getDriveClient();
      log.info('Fetching Drive importFormats');

      try {
        const aboutRes = await drive.about.get({ fields: 'importFormats' });
        const importFormats = (aboutRes.data.importFormats || {}) as Record<string, string[]>;

        const targetFilterMime = args.targetType
          ? GOOGLE_TYPE_MAP[args.targetType as GoogleTargetShort]
          : undefined;

        const entries: ConversionEntry[] = [];
        for (const [sourceMime, targets] of Object.entries(importFormats)) {
          if (args.sourceMimeType && sourceMime !== args.sourceMimeType) continue;
          if (targetFilterMime && !targets.includes(targetFilterMime)) continue;
          entries.push({
            sourceMime,
            extensions: extensionsForMime(sourceMime),
            targets,
          });
        }

        entries.sort((a, b) => a.sourceMime.localeCompare(b.sourceMime));

        return JSON.stringify(
          {
            count: entries.length,
            filters: {
              sourceMimeType: args.sourceMimeType,
              targetType: args.targetType,
            },
            entries,
          },
          null,
          2
        );
      } catch (error: any) {
        log.error(`Error fetching importFormats: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to list supported conversions: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
