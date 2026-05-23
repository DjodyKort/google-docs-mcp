import { describe, expect, it } from 'vitest';
import { extractDocumentTables, findHeadings, getTableById } from './structureHelpers.js';

// Shared tabbed-document fixture — represents the shape returned by
// documents.get when includeTabsContent: true and a tabs field mask is used.
const mockTabbedDocument = {
  // No top-level body — only tabs are populated when includeTabsContent: true
  tabs: [
    {
      tabProperties: { tabId: 'tab-a', title: 'Main' },
      documentTab: {
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 20,
              paragraph: {
                paragraphStyle: { namedStyleType: 'HEADING_1' },
                elements: [{ textRun: { content: 'Sprint Tasks\n' } }],
              },
            },
            {
              startIndex: 20,
              endIndex: 80,
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        startIndex: 25,
                        endIndex: 35,
                        content: [{ paragraph: { elements: [{ textRun: { content: 'No.\n' } }] } }],
                      },
                      {
                        startIndex: 35,
                        endIndex: 50,
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Task\n' } }] } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    },
    {
      tabProperties: { tabId: 'tab-b', title: 'Notes' },
      documentTab: {
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 15,
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        startIndex: 5,
                        endIndex: 14,
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Note\n' } }] } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  ],
} as any;

const mockDocument = {
  body: {
    content: [
      {
        startIndex: 1,
        endIndex: 25,
        paragraph: {
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          elements: [{ textRun: { content: '今回のスプリントのタスク\n' } }],
        },
      },
      {
        startIndex: 25,
        endIndex: 120,
        table: {
          tableRows: [
            {
              tableCells: [
                {
                  startIndex: 30,
                  endIndex: 40,
                  content: [
                    {
                      paragraph: {
                        elements: [{ textRun: { content: 'No.\n' } }],
                      },
                    },
                  ],
                },
                {
                  startIndex: 40,
                  endIndex: 60,
                  content: [
                    {
                      paragraph: {
                        elements: [{ textRun: { content: '課題名\n' } }],
                      },
                    },
                  ],
                },
              ],
            },
            {
              tableCells: [
                {
                  startIndex: 60,
                  endIndex: 78,
                  content: [
                    {
                      paragraph: {
                        elements: [{ textRun: { content: '1\n' } }],
                      },
                    },
                  ],
                },
                {
                  startIndex: 78,
                  endIndex: 118,
                  content: [
                    {
                      paragraph: {
                        elements: [{ textRun: { content: 'SHIN-2870 調査\n' } }],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      {
        startIndex: 120,
        endIndex: 145,
        paragraph: {
          paragraphStyle: { namedStyleType: 'HEADING_2' },
          elements: [{ textRun: { content: '5. TDAからTAPへの確認事項\n' } }],
        },
      },
    ],
  },
} as any;

describe('structureHelpers', () => {
  it('extracts tables with dimensions and cell text', () => {
    const tables = extractDocumentTables(mockDocument);

    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({
      tableId: 'table:body:0',
      rowCount: 2,
      columnCount: 2,
      startIndex: 25,
      endIndex: 120,
    });
    expect(tables[0].cells).toEqual([
      {
        rowIndex: 0,
        columnIndex: 0,
        startIndex: 30,
        endIndex: 40,
        contentStartIndex: null,
        contentEndIndex: null,
        text: 'No.',
      },
      {
        rowIndex: 0,
        columnIndex: 1,
        startIndex: 40,
        endIndex: 60,
        contentStartIndex: null,
        contentEndIndex: null,
        text: '課題名',
      },
      {
        rowIndex: 1,
        columnIndex: 0,
        startIndex: 60,
        endIndex: 78,
        contentStartIndex: null,
        contentEndIndex: null,
        text: '1',
      },
      {
        rowIndex: 1,
        columnIndex: 1,
        startIndex: 78,
        endIndex: 118,
        contentStartIndex: null,
        contentEndIndex: null,
        text: 'SHIN-2870 調査',
      },
    ]);
  });

  it('finds a table by its MCP table ID', () => {
    const table = getTableById(mockDocument, 'table:body:0');

    expect(table?.tableId).toBe('table:body:0');
    expect(getTableById(mockDocument, 'table:body:999')).toBeNull();
  });

  it('finds heading sections and the next table following the heading', () => {
    const sections = findHeadings(mockDocument, [
      '今回のスプリントのタスク',
      '5. TDAからTAPへの確認事項',
    ]);

    expect(sections).toEqual([
      {
        headingText: '今回のスプリントのタスク',
        headingLevel: 'HEADING_2',
        startIndex: 1,
        endIndex: 25,
        tableIdFollowing: 'table:body:0',
      },
      {
        headingText: '5. TDAからTAPへの確認事項',
        headingLevel: 'HEADING_2',
        startIndex: 120,
        endIndex: 145,
        tableIdFollowing: undefined,
      },
    ]);
  });
});

// ── Tabbed document tests ────────────────────────────────────────────────────
// These tests guard the path that was broken before the field mask fix:
// when tabId is provided, documents.get returns tabs[].documentTab.body rather
// than doc.body. All structure helpers must read from the correct source.
describe('structureHelpers — tabbed document path', () => {
  it('extractDocumentTables scopes to the specified tab', () => {
    const tabATables = extractDocumentTables(mockTabbedDocument, 'tab-a');
    expect(tabATables).toHaveLength(1);
    expect(tabATables[0].tableId).toBe('table:tab-a:0');
    expect(tabATables[0].rowCount).toBe(1);
    expect(tabATables[0].columnCount).toBe(2);
    expect(tabATables[0].startIndex).toBe(20);

    const tabBTables = extractDocumentTables(mockTabbedDocument, 'tab-b');
    expect(tabBTables).toHaveLength(1);
    expect(tabBTables[0].tableId).toBe('table:tab-b:0');
    expect(tabBTables[0].columnCount).toBe(1);
  });

  it('extractDocumentTables does NOT bleed across tabs', () => {
    // Tab A has a 2-column table; tab B has a 1-column table.
    // Reading tab B should never return the tab A table.
    const tabBTables = extractDocumentTables(mockTabbedDocument, 'tab-b');
    expect(tabBTables.every((t) => t.tableId.startsWith('table:tab-b:'))).toBe(true);
    expect(tabBTables.find((t) => t.columnCount === 2)).toBeUndefined();
  });

  it('getTableById returns null for an ID from a different tab', () => {
    // table:tab-a:0 should not be found when querying tab-b
    const result = getTableById(mockTabbedDocument, 'table:tab-a:0', 'tab-b');
    expect(result).toBeNull();
  });

  it('getTableById finds the table when the correct tabId is provided', () => {
    const result = getTableById(mockTabbedDocument, 'table:tab-a:0', 'tab-a');
    expect(result).not.toBeNull();
    expect(result!.tableId).toBe('table:tab-a:0');
  });

  it('findHeadings reads from the correct tab', () => {
    const sections = findHeadings(mockTabbedDocument, ['Sprint Tasks'], 'tab-a');
    expect(sections).toHaveLength(1);
    expect(sections[0].headingText).toBe('Sprint Tasks');
    expect(sections[0].headingLevel).toBe('HEADING_1');
  });

  it('findHeadings returns empty for a heading that only exists in another tab', () => {
    // 'Sprint Tasks' is in tab-a only — should not be found when scoped to tab-b
    const sections = findHeadings(mockTabbedDocument, ['Sprint Tasks'], 'tab-b');
    expect(sections).toHaveLength(0);
  });

  it('extractDocumentTables returns empty array for an unknown tabId', () => {
    // Before the fix, an unknown tabId would silently fall back to doc.body
    // or throw. Now getContentSource returns [] for a missing tab.
    const tables = extractDocumentTables(mockTabbedDocument, 'tab-does-not-exist');
    expect(tables).toHaveLength(0);
  });
});
