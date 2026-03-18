import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../../clients.js';
import { DocumentIdParameter } from '../../../types.js';
import * as GDocsHelpers from '../../../googleDocsApiHelpers.js';

const BULLET_PRESETS = [
  'BULLET_DISC_CIRCLE_SQUARE',
  'BULLET_DIAMONDX_ARROW3D_SQUARE',
  'BULLET_CHECKBOX',
  'BULLET_ARROW_DIAMOND_DISC',
  'BULLET_STAR_CIRCLE_SQUARE',
  'BULLET_ARROW3D_CIRCLE_SQUARE',
  'BULLET_LEFTTRIANGLE_DIAMOND_DISC',
  'BULLET_DIAMONDX_HOLLOWDIAMOND_SQUARE',
  'BULLET_DIAMOND_CIRCLE_SQUARE',
  'NUMBERED_DECIMAL_ALPHA_ROMAN',
  'NUMBERED_DECIMAL_ALPHA_ROMAN_PARENS',
  'NUMBERED_DECIMAL_NESTED',
  'NUMBERED_UPPERALPHA_ALPHA_ROMAN',
  'NUMBERED_UPPERROMAN_UPPERALPHA_DECIMAL',
  'NUMBERED_ZERODECIMAL_ALPHA_ROMAN',
] as const;

export function register(server: FastMCP) {
  server.addTool({
    name: 'createParagraphBullets',
    description:
      'Applies bullet or numbered list formatting to paragraphs within a range. ' +
      'Bullet presets starting with BULLET_ create unordered lists; ' +
      'presets starting with NUMBERED_ create ordered lists. ' +
      'Each preset defines glyph styles for up to 3 nesting levels.',
    parameters: DocumentIdParameter.extend({
      startIndex: z
        .number()
        .int()
        .min(1)
        .describe('Start of the range (1-based, inclusive). All paragraphs overlapping this range get bullets.'),
      endIndex: z
        .number()
        .int()
        .min(1)
        .describe('End of the range (1-based, exclusive).'),
      bulletPreset: z
        .enum(BULLET_PRESETS)
        .describe(
          'The bullet/numbering preset to apply. ' +
            'Unordered: BULLET_DISC_CIRCLE_SQUARE (default bullets), BULLET_CHECKBOX, etc. ' +
            'Ordered: NUMBERED_DECIMAL_ALPHA_ROMAN (1. a. i.), NUMBERED_DECIMAL_NESTED (1. 1.1. 1.1.1.), etc.'
        ),
      tabId: z
        .string()
        .optional()
        .describe(
          'The ID of the specific tab. If not specified, operates on the first tab.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(
        `Creating paragraph bullets in doc ${args.documentId} for range ${args.startIndex}-${args.endIndex} with preset ${args.bulletPreset}`
      );

      try {
        if (args.endIndex <= args.startIndex) {
          throw new UserError('endIndex must be greater than startIndex.');
        }

        const range: any = {
          startIndex: args.startIndex,
          endIndex: args.endIndex,
        };
        if (args.tabId) range.tabId = args.tabId;

        const request: any = {
          createParagraphBullets: {
            range,
            bulletPreset: args.bulletPreset,
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return (
          `Successfully applied bullet preset "${args.bulletPreset}" to range ${args.startIndex}-${args.endIndex}` +
          `${args.tabId ? ` in tab ${args.tabId}` : ''}.`
        );
      } catch (error: any) {
        log.error(`Error creating paragraph bullets: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to create paragraph bullets: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
