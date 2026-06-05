import { describe, it, expect } from 'vitest';
import { extractCommentLocation, a1ToRowCol, rowColToA1 } from './commentAnchor.js';

/**
 * Regression coverage for the bug where location filters returned empty for
 * API-created comments. Those comments carry no Drive `anchor`; their location
 * lives only in the click-through deep link in the body. These tests exercise
 * the exact filter predicate used by listSheetsComments against a comment shaped
 * like the real Drive response observed on a live spreadsheet.
 */

// The real comment object observed from drive.comments.list for a B3 comment
// created by createSheetsComment (no anchor, deep link in content).
const apiCreatedB3Comment = {
  id: 'AAAB84sZzyI',
  content:
    "Review: Bob's score looks off\n\n→ Sheet1!B3: https://docs.google.com/spreadsheets/d/ABC/edit#gid=0&range=B3",
  anchor: undefined as string | undefined,
  resolved: false,
};

// Mirror of the single-cell filter branch in listSheetsComments.
function matchesCellFilter(
  comment: { anchor?: string; content?: string },
  cellA1: string
): boolean {
  const cellInfo = extractCommentLocation(comment);
  const cellFilter = a1ToRowCol(cellA1);
  if (!cellInfo || !cellFilter) return false;
  return cellInfo.row === cellFilter.row && cellInfo.col === cellFilter.col;
}

describe('listSheetsComments location filter (regression)', () => {
  it('matches an API-created comment by its target cell via the deep link', () => {
    expect(matchesCellFilter(apiCreatedB3Comment, 'B3')).toBe(true);
  });

  it('does not match a different cell', () => {
    expect(matchesCellFilter(apiCreatedB3Comment, 'C4')).toBe(false);
  });

  it('resolves the cell ref for display from the deep link', () => {
    const loc = extractCommentLocation(apiCreatedB3Comment);
    expect(loc).not.toBeNull();
    expect(rowColToA1(loc!.row, loc!.col)).toBe('B3');
  });

  it('still matches a native comment that carries a real anchor', () => {
    const native = {
      anchor: JSON.stringify({ a: [{ sht: { sid: 0, rng: { r: 2, c: 1 } } }] }),
      content: 'human comment',
    };
    expect(matchesCellFilter(native, 'B3')).toBe(true);
  });
});
