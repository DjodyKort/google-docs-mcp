import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import { getDocsClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';

export function registerAddTab(server: FastMCP) {
  server.addTool({
    name: 'addDocumentTab',
    description:
      'Adds a new tab to a Google Docs document. Tabs are like separate pages/sections ' +
      'within the same document, each with their own content.',
    parameters: DocumentIdParameter.extend({
      title: z
        .string()
        .min(1)
        .describe('The title for the new tab.'),
      parentTabId: z
        .string()
        .optional()
        .describe(
          'The ID of the parent tab for nesting. If omitted, the tab is added at the top level.'
        ),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Adding tab "${args.title}" to doc ${args.documentId}`);

      try {
        const tabProperties: any = {
          title: args.title,
        };

        const request: any = {
          addDocumentTab: {
            tabProperties,
            ...(args.parentTabId && { parentTabId: args.parentTabId }),
          },
        };

        const response = await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);
        const tabId = (response.replies as any)?.[0]?.addDocumentTab?.tabId;

        return (
          `Successfully added tab "${args.title}"` +
          (tabId ? ` (ID: ${tabId})` : '') +
          (args.parentTabId ? ` under parent tab ${args.parentTabId}` : '') +
          '.'
        );
      } catch (error: any) {
        log.error(`Error adding tab: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to add tab: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

export function registerDeleteTab(server: FastMCP) {
  server.addTool({
    name: 'deleteTab',
    description:
      'Deletes a tab from a Google Docs document. The tab and all its content are permanently removed. ' +
      'Use listDocumentTabs to find tab IDs. Cannot delete the last remaining tab.',
    parameters: DocumentIdParameter.extend({
      tabId: z
        .string()
        .describe('The ID of the tab to delete.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Deleting tab ${args.tabId} from doc ${args.documentId}`);

      try {
        const request: any = {
          deleteTab: {
            tabId: args.tabId,
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully deleted tab ${args.tabId}.`;
      } catch (error: any) {
        log.error(`Error deleting tab: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(`Failed to delete tab: ${error.message || 'Unknown error'}`);
      }
    },
  });
}

export function registerUpdateTabProperties(server: FastMCP) {
  server.addTool({
    name: 'updateDocumentTabProperties',
    description:
      'Updates properties of a document tab (title, etc.). ' +
      'Use listDocumentTabs to find tab IDs.',
    parameters: DocumentIdParameter.extend({
      tabId: z
        .string()
        .describe('The ID of the tab to update.'),
      title: z
        .string()
        .min(1)
        .optional()
        .describe('New title for the tab.'),
    }),
    execute: async (args, { log }) => {
      const docs = await getDocsClient();

      log.info(`Updating tab ${args.tabId} properties in doc ${args.documentId}`);

      try {
        const fieldsToUpdate: string[] = [];
        const tabProperties: any = {};

        if (args.title !== undefined) {
          tabProperties.title = args.title;
          fieldsToUpdate.push('title');
        }

        if (fieldsToUpdate.length === 0) {
          return 'No tab properties were provided to update.';
        }

        const request: any = {
          updateDocumentTabProperties: {
            tabId: args.tabId,
            documentTabProperties: tabProperties,
            fields: fieldsToUpdate.join(','),
          },
        };

        await GDocsHelpers.executeBatchUpdate(docs, args.documentId, [request]);

        return `Successfully updated tab ${args.tabId} properties (${fieldsToUpdate.join(', ')}).`;
      } catch (error: any) {
        log.error(`Error updating tab properties: ${error.message || error}`);
        if (error instanceof UserError) throw error;
        throw new UserError(
          `Failed to update tab properties: ${error.message || 'Unknown error'}`
        );
      }
    },
  });
}
