import type { FastMCP } from 'fastmcp';
import { buildCachedToolsListPayload } from '../cachedToolsList.js';
import { DEFAULT_TOOL_GROUPS, registerAllTools, TOOL_GROUPS, type ToolGroup } from './index.js';

type ToolConfig = Parameters<FastMCP['addTool']>[0];

export interface TokenBudget {
  heuristic: string;
  tolerancePercent: number;
  groups: Record<string, number>;
  default: number;
  all: number;
}

export const BUDGET_TOLERANCE_PERCENT = 5;
export const HEURISTIC =
  'ceil(JSON.stringify({name, description, inputSchema, annotations}).length / 4)';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function measure(groups: readonly ToolGroup[]): Promise<number> {
  const tools: ToolConfig[] = [];
  registerAllTools(
    { addTool: (tool: ToolConfig) => tools.push(tool) } as unknown as FastMCP,
    groups
  );
  const payload = await buildCachedToolsListPayload(tools.filter((t) => t.name !== 'authStatus'));
  return payload.tools.reduce((sum, tool) => sum + estimateTokens(JSON.stringify(tool)), 0);
}

export async function measureTokenBudget(): Promise<TokenBudget> {
  const groups: Record<string, number> = {};
  for (const group of TOOL_GROUPS) groups[group] = await measure([group]);
  return {
    heuristic: HEURISTIC,
    tolerancePercent: BUDGET_TOLERANCE_PERCENT,
    groups,
    default: await measure(DEFAULT_TOOL_GROUPS),
    all: await measure(TOOL_GROUPS),
  };
}
