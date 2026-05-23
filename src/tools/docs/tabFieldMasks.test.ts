import { describe, expect, it } from 'vitest';
import {
  TAB_FIELD_MASKS,
  TABLE_INDEX_BODY_FIELDS,
  TABLE_CONTENT_BASIC_BODY_FIELDS,
  TABLE_CONTENT_INDEXED_BODY_FIELDS,
  HEADING_BODY_FIELDS,
  SMART_CHIP_BODY_FIELDS,
  buildDocumentGetFields,
} from './tabFieldMasks.js';

describe('Google Docs tab field masks', () => {
  it('uses explicit tab properties instead of broad tab expansions', () => {
    for (const mask of Object.values(TAB_FIELD_MASKS)) {
      expect(mask).not.toContain('tabs)');
      expect(mask).not.toContain('tabProperties,');
      expect(mask).not.toContain('childTabs(tabProperties,');
      expect(mask).toContain('tabProperties(tabId');
    }
  });
});

describe('buildDocumentGetFields', () => {
  it('returns the body fields unchanged when no tabId is provided', () => {
    const result = buildDocumentGetFields(TABLE_INDEX_BODY_FIELDS);
    expect(result).toBe(TABLE_INDEX_BODY_FIELDS);
    expect(result).toMatch(/^body\(/);
    // Must not contain any tabs field mask wrapper — this would cause the
    // "Field mask cannot retrieve document.tabs and legacy text-level fields"
    // API error when passed alongside includeTabsContent: false
    expect(result).not.toContain('tabs(');
    expect(result).not.toContain('tabProperties');
  });

  it('wraps body fields in a tabs mask when tabId is provided', () => {
    const result = buildDocumentGetFields(TABLE_INDEX_BODY_FIELDS, 't.abc123');
    expect(result).toMatch(/^tabs\(/);
    expect(result).toContain('tabProperties(tabId)');
    expect(result).toContain('documentTab(');
    expect(result).toContain(TABLE_INDEX_BODY_FIELDS);
    // Must not contain a bare body(...) at the top level — mixing body + tabs
    // in the same field mask causes the conflict error
    expect(result).not.toMatch(/^body\(/);
  });

  it('produces tabs masks for all shared body field constants', () => {
    const constants = [
      TABLE_INDEX_BODY_FIELDS,
      TABLE_CONTENT_BASIC_BODY_FIELDS,
      TABLE_CONTENT_INDEXED_BODY_FIELDS,
      HEADING_BODY_FIELDS,
      SMART_CHIP_BODY_FIELDS,
    ];

    for (const bodyFields of constants) {
      const withTab = buildDocumentGetFields(bodyFields, 't.abc');
      const withoutTab = buildDocumentGetFields(bodyFields);

      // With tabId: must be a tabs-only mask (no bare legacy body at root)
      expect(withTab).toMatch(/^tabs\(/);
      expect(withTab).not.toMatch(/^body\(/);

      // Without tabId: must be a plain body mask (no tabs wrapper)
      expect(withoutTab).toMatch(/^body\(/);
      expect(withoutTab).not.toContain('tabs(');
    }
  });
});
