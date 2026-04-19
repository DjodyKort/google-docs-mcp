import { describe, it, expect } from 'vitest';
import {
  extractContentType,
  mimeToExtension,
  buildImageFileName,
  collectImages,
  IMAGE_MIME_TO_EXTENSION,
} from './downloadImages.js';

describe('extractContentType', () => {
  it('returns the bare MIME type', () => {
    expect(extractContentType('image/png')).toBe('image/png');
  });

  it('strips charset parameters', () => {
    expect(extractContentType('text/html; charset=utf-8')).toBe('text/html');
  });

  it('strips parameters with semicolons and whitespace', () => {
    expect(extractContentType('image/jpeg ; boundary=something')).toBe('image/jpeg');
  });

  it('lower-cases the result', () => {
    expect(extractContentType('IMAGE/PNG')).toBe('image/png');
  });

  it('falls back to octet-stream on missing header', () => {
    expect(extractContentType(undefined)).toBe('application/octet-stream');
    expect(extractContentType(null)).toBe('application/octet-stream');
    expect(extractContentType('')).toBe('application/octet-stream');
  });
});

describe('mimeToExtension', () => {
  it('maps png, jpeg, gif, webp, svg to familiar extensions', () => {
    expect(mimeToExtension('image/png')).toBe('.png');
    expect(mimeToExtension('image/jpeg')).toBe('.jpg');
    expect(mimeToExtension('image/gif')).toBe('.gif');
    expect(mimeToExtension('image/webp')).toBe('.webp');
    expect(mimeToExtension('image/svg+xml')).toBe('.svg');
  });

  it('treats "image/jpg" as a synonym for jpeg', () => {
    expect(mimeToExtension('image/jpg')).toBe('.jpg');
  });

  it('still works when charset parameters leak in', () => {
    expect(mimeToExtension('image/png; charset=binary')).toBe('.png');
  });

  it('falls back to .bin for unknown types', () => {
    expect(mimeToExtension('application/octet-stream')).toBe('.bin');
    expect(mimeToExtension('weird/type')).toBe('.bin');
  });

  it('every mapped MIME type yields a non-bin extension', () => {
    for (const mime of Object.keys(IMAGE_MIME_TO_EXTENSION)) {
      expect(mimeToExtension(mime)).not.toBe('.bin');
    }
  });
});

describe('buildImageFileName', () => {
  it('zero-pads the sequence number to 3 digits', () => {
    expect(buildImageFileName(0, 'kix.a', '.png', new Set())).toBe('image-001.png');
    expect(buildImageFileName(9, 'kix.a', '.png', new Set())).toBe('image-010.png');
    expect(buildImageFileName(99, 'kix.a', '.png', new Set())).toBe('image-100.png');
  });

  it('suffixes with the objectId on collision', () => {
    const used = new Set<string>(['image-001.png']);
    expect(buildImageFileName(0, 'kix.abc', '.png', used)).toBe('image-001-kix.abc.png');
  });

  it('sanitizes unsafe characters in the objectId suffix', () => {
    const used = new Set<string>(['image-001.png']);
    expect(buildImageFileName(0, 'kix/bad id!', '.png', used)).toBe('image-001-kix_bad_id_.png');
  });

  it('respects the provided extension', () => {
    expect(buildImageFileName(0, 'kix.a', '.gif', new Set())).toBe('image-001.gif');
    expect(buildImageFileName(0, 'kix.a', '.bin', new Set())).toBe('image-001.bin');
  });
});

describe('collectImages', () => {
  const inlineObjects = {
    'kix.inline1': {
      inlineObjectProperties: {
        embeddedObject: {
          imageProperties: { contentUri: 'https://example.com/1', sourceUri: 'https://src/1' },
        },
      },
    },
    'kix.inline2': {
      inlineObjectProperties: {
        embeddedObject: {
          imageProperties: { contentUri: 'https://example.com/2' },
        },
      },
    },
    'kix.notAnImage': {
      inlineObjectProperties: {
        embeddedObject: {
          // No imageProperties — e.g. an embedded drawing
          embeddedDrawingProperties: {},
        },
      },
    },
  };

  const positionedObjects = {
    'kix.pos1': {
      positionedObjectProperties: {
        embeddedObject: {
          imageProperties: { contentUri: 'https://example.com/p1' },
        },
      },
    },
  };

  it('returns [] for empty or missing source', () => {
    expect(collectImages(null)).toEqual([]);
    expect(collectImages(undefined)).toEqual([]);
    expect(collectImages({})).toEqual([]);
    expect(collectImages({ inlineObjects: {} })).toEqual([]);
  });

  it('walks inlineObjects and positionedObjects', () => {
    const refs = collectImages({ inlineObjects, positionedObjects });
    expect(refs).toHaveLength(3);
    expect(refs.map((r) => r.objectId).sort()).toEqual([
      'kix.inline1',
      'kix.inline2',
      'kix.pos1',
    ]);
  });

  it('tags the kind correctly', () => {
    const refs = collectImages({ inlineObjects, positionedObjects });
    const byId = Object.fromEntries(refs.map((r) => [r.objectId, r.kind]));
    expect(byId['kix.inline1']).toBe('inline');
    expect(byId['kix.inline2']).toBe('inline');
    expect(byId['kix.pos1']).toBe('positioned');
  });

  it('skips embedded objects without a contentUri', () => {
    const refs = collectImages({ inlineObjects });
    expect(refs.find((r) => r.objectId === 'kix.notAnImage')).toBeUndefined();
  });

  it('carries sourceUri through when present', () => {
    const refs = collectImages({ inlineObjects });
    const first = refs.find((r) => r.objectId === 'kix.inline1');
    expect(first?.sourceUri).toBe('https://src/1');
    const second = refs.find((r) => r.objectId === 'kix.inline2');
    expect(second?.sourceUri).toBeUndefined();
  });

  it('filters by imageObjectIds when provided', () => {
    const refs = collectImages(
      { inlineObjects, positionedObjects },
      { imageObjectIds: ['kix.inline1', 'kix.pos1'] }
    );
    expect(refs.map((r) => r.objectId).sort()).toEqual(['kix.inline1', 'kix.pos1']);
  });

  it('returns [] when the filter matches nothing', () => {
    const refs = collectImages(
      { inlineObjects, positionedObjects },
      { imageObjectIds: ['kix.nope'] }
    );
    expect(refs).toEqual([]);
  });

  it('treats an empty imageObjectIds array as "no filter"', () => {
    const refs = collectImages(
      { inlineObjects, positionedObjects },
      { imageObjectIds: [] }
    );
    expect(refs).toHaveLength(3);
  });
});
