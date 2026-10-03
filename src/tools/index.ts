// src/tools/index.ts
import type { FastMCP } from 'fastmcp';
import { registerDocsTools } from './docs/index.js';
import { registerDriveTools } from './drive/index.js';
import { registerSheetsTools } from './sheets/index.js';
import { registerUtilsTools } from './utils/index.js';
import { registerGmailTools } from './gmail/index.js';
import { registerCalendarTools } from './calendar/index.js';
import { registerScriptTools } from './script/index.js';
import { registerAuthTools } from './auth/index.js';

export const CORE_TOOL_GROUPS = [
  'docs',
  'drive',
  'sheets',
  'utils',
  'gmail',
  'calendar',
  'script',
] as const;

export const OPT_IN_SUBGROUPS = {
  'docs-advanced': [
    'createHeader',
    'createFooter',
    'deleteHeader',
    'deleteFooter',
    'createFootnote',
    'createNamedRange',
    'deleteNamedRange',
    'replaceNamedRangeContent',
    'deletePositionedObject',
    'insertDateChip',
    'insertPerson',
    'insertRichLink',
    'listSmartChips',
    'insertSectionBreak',
    'updateSectionStyle',
    'updateDocumentStyle',
    'cloneTable',
  ],
  comments: [
    'addComment',
    'replyToComment',
    'resolveComment',
    'getComment',
    'listComments',
    'deleteComment',
    'createSheetsComment',
    'createSheetsCellNote',
    'listSheetsComments',
    'getSheetsComment',
    'replyToSheetsComment',
    'resolveSheetsComment',
    'deleteSheetsComment',
  ],
  'sheets-advanced': [
    'insertChart',
    'deleteChart',
    'addConditionalFormatting',
    'getConditionalFormatting',
    'deleteConditionalFormatting',
    'protectRange',
    'groupRows',
    'ungroupAllRows',
    'setDropdownValidation',
    'copyFormatting',
    'setCellBorders',
  ],
  'drive-permissions': ['setFilePermission'],
  'drive-convert': [
    'convertFile',
    'uploadAndConvert',
    'listSupportedConversions',
    'exportPresentation',
    'exportDrawing',
  ],
  'gmail-extras': [
    'createDraft',
    'listDrafts',
    'getDraft',
    'updateDraft',
    'sendDraft',
    'deleteDraft',
    'triageInbox',
  ],
} as const;

export type OptInSubgroup = keyof typeof OPT_IN_SUBGROUPS;

export const OPT_IN_SUBGROUP_NAMES = Object.keys(OPT_IN_SUBGROUPS) as OptInSubgroup[];

export const TOOL_GROUPS = [...CORE_TOOL_GROUPS, ...OPT_IN_SUBGROUP_NAMES] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

const DEFAULT_OFF = new Set<ToolGroup>(['script', ...OPT_IN_SUBGROUP_NAMES]);

export const DEFAULT_TOOL_GROUPS: readonly ToolGroup[] = TOOL_GROUPS.filter(
  (group) => !DEFAULT_OFF.has(group)
);

const TOOL_GROUP_SET = new Set<string>(TOOL_GROUPS);

const SUBGROUP_OF_TOOL = new Map<string, OptInSubgroup>(
  OPT_IN_SUBGROUP_NAMES.flatMap((group) =>
    (OPT_IN_SUBGROUPS[group] as readonly string[]).map((name) => [name, group] as const)
  )
);

const PARENT_GROUPS: Record<OptInSubgroup, readonly ToolGroup[]> = {
  'docs-advanced': ['docs'],
  comments: ['docs', 'sheets'],
  'sheets-advanced': ['sheets'],
  'drive-permissions': ['drive'],
  'drive-convert': ['drive'],
  'gmail-extras': ['gmail'],
};

export function parseEnabledToolGroups(raw: string | undefined = process.env.MCP_TOOL_GROUPS) {
  if (!raw?.trim()) return [...DEFAULT_TOOL_GROUPS];

  const requested = raw
    .split(',')
    .map((group) => group.trim().toLowerCase())
    .filter(Boolean);

  if (requested.includes('all')) return [...TOOL_GROUPS];

  const selected = new Set<string>();
  const unknown: string[] = [];
  for (const group of requested) {
    if (group === 'default') DEFAULT_TOOL_GROUPS.forEach((g) => selected.add(g));
    else if (TOOL_GROUP_SET.has(group)) selected.add(group);
    else unknown.push(group);
  }

  if (unknown.length > 0) {
    process.stderr.write(
      `[google-docs-mcp] Ignoring unknown MCP_TOOL_GROUPS value(s): ${unknown.join(', ')}. ` +
        `Valid groups: ${TOOL_GROUPS.join(', ')}, default, all\n`
    );
  }

  if (selected.size === 0) return [...DEFAULT_TOOL_GROUPS];

  return TOOL_GROUPS.filter((group) => selected.has(group));
}

/**
 * Registers all tools with the FastMCP server.
 */
export function registerAllTools(
  server: FastMCP,
  enabledGroups: readonly ToolGroup[] = parseEnabledToolGroups()
) {
  const enabled = new Set<ToolGroup>(enabledGroups);
  const filtered = Object.create(server) as FastMCP;
  filtered.addTool = ((tool: Parameters<FastMCP['addTool']>[0]) => {
    const subgroup = SUBGROUP_OF_TOOL.get(tool.name);
    if (subgroup ? !enabled.has(subgroup) : !enabled.has(currentGroup)) return;
    server.addTool(tool);
  }) as FastMCP['addTool'];

  let currentGroup: ToolGroup = 'docs';
  const groupsToRegister = new Set<ToolGroup>();
  for (const group of enabled) {
    if (group in PARENT_GROUPS) {
      PARENT_GROUPS[group as OptInSubgroup].forEach((parent) => groupsToRegister.add(parent));
    } else {
      groupsToRegister.add(group);
    }
  }

  for (const group of CORE_TOOL_GROUPS) {
    if (!groupsToRegister.has(group)) continue;
    currentGroup = group;
    switch (group) {
      case 'docs':
        registerDocsTools(filtered);
        break;
      case 'drive':
        registerDriveTools(filtered);
        break;
      case 'sheets':
        registerSheetsTools(filtered);
        break;
      case 'utils':
        registerUtilsTools(filtered);
        break;
      case 'gmail':
        registerGmailTools(filtered);
        break;
      case 'calendar':
        registerCalendarTools(filtered);
        break;
      case 'script':
        registerScriptTools(filtered);
        break;
    }
  }
  registerAuthTools(server);
}
