import { describe, it, expect } from 'vitest';
import { extractCommentLocation } from './commentAnchor.js';

describe('extractCommentLocation', () => {
  it('reads a real Drive anchor when present', () => {
    const anchor = JSON.stringify({
      r: 'head',
      a: [{ sht: { sid: 12345, rng: { r: 2, c: 1 } } }],
    });
    const loc = extractCommentLocation({ anchor, content: 'no link here' });
    expect(loc).toEqual({ sheetId: 12345, row: 2, col: 1 });
  });

  it('falls back to the deep-link in the content for API-created comments', () => {
    const content =
      "Review: Bob's score looks off\n\n→ Sheet1!B3: https://docs.google.com/spreadsheets/d/ABC/edit#gid=0&range=B3";
    const loc = extractCommentLocation({ content });
    // B3 -> row index 2, col index 1, gid 0
    expect(loc).toEqual({ sheetId: 0, row: 2, col: 1 });
  });

  it('prefers a real anchor over the deep-link when both exist', () => {
    const anchor = JSON.stringify({
      r: 'head',
      a: [{ sht: { sid: 99, rng: { r: 5, c: 5 } } }],
    });
    const content = 'text #gid=0&range=A1';
    const loc = extractCommentLocation({ anchor, content });
    expect(loc).toEqual({ sheetId: 99, row: 5, col: 5 });
  });

  it('uses the top-left cell when the deep-link targets a range', () => {
    // range B3:D5 is URL-encoded as B3%3AD5 by encodeURIComponent
    const content = 'see #gid=7&range=B3%3AD5';
    const loc = extractCommentLocation({ content });
    expect(loc).toEqual({ sheetId: 7, row: 2, col: 1 });
  });

  it('parses a deep-link whose range carries a sheet prefix', () => {
    const content = 'see #gid=3&range=Sheet1!B3';
    const loc = extractCommentLocation({ content });
    expect(loc).toEqual({ sheetId: 3, row: 2, col: 1 });
  });

  it('returns null when there is neither an anchor nor a deep-link', () => {
    expect(extractCommentLocation({ content: 'just a plain comment' })).toBeNull();
    expect(extractCommentLocation({})).toBeNull();
  });

  it('returns null for a malformed anchor and no deep-link', () => {
    expect(extractCommentLocation({ anchor: 'not-json', content: 'plain' })).toBeNull();
  });
});
