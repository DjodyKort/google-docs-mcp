import type { FastMCP } from 'fastmcp';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOOL_GROUPS,
  OPT_IN_SUBGROUP_NAMES,
  OPT_IN_SUBGROUPS,
  parseEnabledToolGroups,
  registerAllTools,
  TOOL_GROUPS,
} from './index.js';

type ToolConfig = Parameters<FastMCP['addTool']>[0];

function captureTools(groups: Parameters<typeof registerAllTools>[1]) {
  const tools: ToolConfig[] = [];
  const server = {
    addTool: (tool: ToolConfig) => {
      tools.push(tool);
    },
  };

  registerAllTools(server as FastMCP, groups);
  return tools.map((tool) => tool.name);
}

describe('parseEnabledToolGroups', () => {
  it('defaults to every group', () => {
    expect(parseEnabledToolGroups(undefined)).toEqual([...TOOL_GROUPS]);
    expect(parseEnabledToolGroups('  ')).toEqual([...TOOL_GROUPS]);
    expect([...DEFAULT_TOOL_GROUPS]).toEqual([...TOOL_GROUPS]);
    expect(DEFAULT_TOOL_GROUPS).toContain('script');
    for (const group of OPT_IN_SUBGROUP_NAMES) expect(DEFAULT_TOOL_GROUPS).toContain(group);
  });

  it('normalizes comma-separated tool group names in default order', () => {
    expect(parseEnabledToolGroups('sheets, docs, sheets')).toEqual(['docs', 'sheets']);
  });

  it('treats all as every group including opt-in ones', () => {
    expect(parseEnabledToolGroups('all')).toEqual([...TOOL_GROUPS]);
    expect(parseEnabledToolGroups('docs,all')).toEqual([...TOOL_GROUPS]);
  });

  it('selects opt-in groups explicitly and supports the default keyword', () => {
    expect(parseEnabledToolGroups('script')).toEqual(['script']);
    expect(parseEnabledToolGroups('default,script')).toEqual([...TOOL_GROUPS]);
    expect(parseEnabledToolGroups('docs,drive,script')).toEqual(['docs', 'drive', 'script']);
  });

  it('warns on stderr and ignores unknown groups', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(parseEnabledToolGroups('docs,unknown')).toEqual(['docs']);
      expect(write).toHaveBeenCalledWith(expect.stringContaining('unknown'));
      write.mockClear();
      expect(parseEnabledToolGroups('nonsense')).toEqual([...DEFAULT_TOOL_GROUPS]);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
    }
  });
});

describe('default tool set', () => {
  const defaults = captureTools([...DEFAULT_TOOL_GROUPS]);
  const everything = captureTools([...TOOL_GROUPS]);

  it('registers every tool by default, including former opt-in families', () => {
    for (const name of [
      'readDocument',
      'applyTextStyle',
      'listSpreadsheets',
      'sendEmail',
      'listEvents',
      'listMessages',
      'searchDriveFiles',
      'authStatus',
      'createAppsScriptProject',
      'setFilePermission',
      'triageInbox',
      'insertChart',
      'addComment',
      'createHeader',
      'convertFile',
    ]) {
      expect(defaults).toContain(name);
    }
    expect([...defaults].sort()).toEqual([...everything].sort());
  });

  it('trimming with explicit groups drops the others', () => {
    const trimmed = captureTools(parseEnabledToolGroups('docs,drive'));
    expect(trimmed).toContain('readDocument');
    expect(trimmed).not.toContain('createAppsScriptProject');
    expect(trimmed).not.toContain('addComment');
    expect(trimmed.length).toBeLessThan(defaults.length);
  });

  it('all registers every tool and every opt-in tool belongs to a real tool', () => {
    for (const group of OPT_IN_SUBGROUP_NAMES) {
      for (const name of OPT_IN_SUBGROUPS[group])
        expect(everything, `${group}:${name}`).toContain(name);
    }
    expect(everything.length).toBe(defaults.length);
  });

  it('registers an opt-in group on its own, without its parent group', () => {
    expect(captureTools(['drive-permissions']).sort()).toEqual(['authStatus', 'setFilePermission']);
    expect(captureTools(['comments']).sort()).toContain('addComment');
    expect(captureTools(['comments'])).toContain('createSheetsComment');
    expect(captureTools(['comments'])).not.toContain('readDocument');
  });

  it('keeps tool names unique in the full set', () => {
    expect(everything.filter((n, i) => everything.indexOf(n) !== i)).toEqual([]);
  });
});

describe('registerAllTools', () => {
  it('registers only the selected groups', () => {
    const toolNames = captureTools(['docs']);

    expect(toolNames).toContain('readDocument');
    expect(toolNames).toContain('appendText');
    expect(toolNames).not.toContain('listSpreadsheets');
    expect(toolNames).not.toContain('sendEmail');
  });

  it('can combine multiple selected groups', () => {
    const toolNames = captureTools(['docs', 'sheets']);

    expect(toolNames).toContain('readDocument');
    expect(toolNames).toContain('listSpreadsheets');
    expect(toolNames).not.toContain('sendEmail');
  });
});

describe('tool registry', () => {
  it('registers every tool name exactly once across all groups', () => {
    const names = captureTools([...TOOL_GROUPS]);
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);

    expect(duplicates).toEqual([]);
  });
});

describe('authStatus tool', () => {
  it('is registered regardless of the selected groups', () => {
    expect(captureTools(['docs'])).toContain('authStatus');
    expect(captureTools([])).toContain('authStatus');
  });
});
