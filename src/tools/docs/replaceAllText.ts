import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

const ReplacementSchema = z.object({
  find: z.string().min(1).describe('The text to search for.'),
  replace: z.string().describe('The text to replace it with.'),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'replaceAllText',
    description:
      'Find and replace text in a Google Doc. Supports single or batch replacements. Preserves all formatting. Case-sensitive by default.',
    parameters: DocumentIdParameter.extend({
      replacements: z
        .array(ReplacementSchema)
        .min(1)
        .describe(
          'Array of find/replace pairs. Each pair has a "find" and "replace" field. All replacements are applied in a single API call.'
        ),
      matchCase: z
        .boolean()
        .optional()
        .default(true)
        .describe('Whether to match case. Defaults to true (case-sensitive).'),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab to target. If not specified, replaces across all tabs.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      log.info(
        `Replacing ${args.replacements.length} text pattern(s) in doc ${args.documentId}`
      );

      try {
        const requests = args.replacements.map((r) => {
          const request: any = {
            replaceAllText: {
              containsText: {
                text: r.find,
                matchCase: args.matchCase,
              },
              replaceText: r.replace,
            },
          };

          if (args.tabId) {
            request.replaceAllText.tabsCriteria = { tabIds: [args.tabId] };
          }

          return request;
        });

        const response = await GDocsHelpers.executeBatchUpdate(
          docs,
          args.documentId,
          requests
        );

        const replies = response.replies || [];
        const results = args.replacements.map((r, i) => {
          const occurrences =
            replies[i]?.replaceAllText?.occurrencesChanged || 0;
          return `"${r.find}" → "${r.replace}": ${occurrences} occurrence(s)`;
        });

        return `Replacements completed:\n${results.join('\n')}`;
      } catch (error: any) {
        log.error(
          `Error replacing text in doc ${args.documentId}: ${error.message || error}`
        );
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to replace text: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
