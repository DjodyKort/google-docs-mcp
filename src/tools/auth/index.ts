import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { computeAuthStatus } from '../../authStatus.js';

export function registerAuthTools(server: FastMCP) {
  server.addTool({
    name: 'authStatus',
    description:
      'Reports the health of the Google login for this profile as JSON (state: ok, expiring, needs_reauth, revoked, misconfigured, unknown). Read-only; makes no network call unless probe is true.',
    parameters: z.object({
      probe: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'If true, run a live refresh-token check (at most once per 6 hours per profile).'
        ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
    execute: async (args) =>
      JSON.stringify(await computeAuthStatus({ probe: args.probe ? 'auto' : 'never' })),
  });
}
