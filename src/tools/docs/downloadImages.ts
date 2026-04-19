import type { FastMCP } from 'fastmcp';
import { UserError } from 'fastmcp';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { getDocsClient, getAuthClient } from '../../clients.js';
import { DocumentIdParameter } from '../../types.js';
import * as GDocsHelpers from '../../googleDocsApiHelpers.js';
import { ensureWithinCwd } from '../drive/exportHelpers.js';

export const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/x-icon': '.ico',
  'image/heic': '.heic',
};

export function extractContentType(headerValue: string | undefined | null): string {
  if (!headerValue) return 'application/octet-stream';
  return headerValue.split(';')[0]!.trim().toLowerCase();
}

export function mimeToExtension(contentType: string): string {
  const mime = extractContentType(contentType);
  return IMAGE_MIME_TO_EXTENSION[mime] ?? '.bin';
}

export function buildImageFileName(
  index: number,
  objectId: string,
  ext: string,
  usedNames: Set<string>
): string {
  const seq = String(index + 1).padStart(3, '0');
  let candidate = `image-${seq}${ext}`;
  if (usedNames.has(candidate)) {
    const sanitizedId = objectId.replace(/[^a-zA-Z0-9._-]/g, '_');
    candidate = `image-${seq}-${sanitizedId}${ext}`;
  }
  return candidate;
}

export type ImageKind = 'inline' | 'positioned';

export interface ImageRef {
  objectId: string;
  kind: ImageKind;
  contentUri: string;
  sourceUri?: string;
}

interface DocumentLikeImageSource {
  inlineObjects?: Record<string, any> | null;
  positionedObjects?: Record<string, any> | null;
}

export function collectImages(
  source: DocumentLikeImageSource | null | undefined,
  filter?: { imageObjectIds?: string[] }
): ImageRef[] {
  if (!source) return [];
  const allow = filter?.imageObjectIds?.length ? new Set(filter.imageObjectIds) : null;
  const out: ImageRef[] = [];

  const walk = (map: Record<string, any> | null | undefined, kind: ImageKind): void => {
    if (!map) return;
    for (const [objectId, obj] of Object.entries(map)) {
      if (allow && !allow.has(objectId)) continue;
      const embedded =
        kind === 'inline'
          ? obj?.inlineObjectProperties?.embeddedObject
          : obj?.positionedObjectProperties?.embeddedObject;
      const contentUri = embedded?.imageProperties?.contentUri;
      if (!contentUri) continue;
      out.push({
        objectId,
        kind,
        contentUri,
        sourceUri: embedded?.imageProperties?.sourceUri ?? undefined,
      });
    }
  };

  walk(source.inlineObjects, 'inline');
  walk(source.positionedObjects, 'positioned');
  return out;
}

function pickImageSource(document: any, tabId: string | undefined): DocumentLikeImageSource | null {
  if (!tabId) {
    return {
      inlineObjects: document?.inlineObjects,
      positionedObjects: document?.positionedObjects,
    };
  }
  const tab = GDocsHelpers.findTabById(document, tabId);
  if (!tab) return null;
  const documentTab = tab.documentTab;
  if (!documentTab) return null;
  return {
    inlineObjects: documentTab.inlineObjects,
    positionedObjects: documentTab.positionedObjects,
  };
}

const DownloadImagesParameters = DocumentIdParameter.extend({
  saveDir: z
    .string()
    .optional()
    .describe(
      'Local directory to save images into. Created if missing. Must be within the current working directory. ' +
        'Defaults to "./images-<documentId>/".'
    ),
  tabId: z
    .string()
    .optional()
    .describe(
      'Restrict to images in this tab. If omitted, downloads images from the document body (or first tab for tabbed documents).'
    ),
  imageObjectIds: z
    .array(z.string())
    .optional()
    .describe(
      'Optional list of inlineObject / positionedObject IDs to filter by. If omitted, every image is downloaded.'
    ),
});

export function register(server: FastMCP) {
  server.addTool({
    name: 'downloadDocumentImages',
    description:
      'Downloads every image (inline and positioned) embedded in a Google Doc to a local directory. ' +
      'Uses the Docs API contentUri so images are authenticated against the caller\'s OAuth session. ' +
      'Returns a JSON manifest of saved images plus any that were skipped.',
    parameters: DownloadImagesParameters,
    execute: async (args, { log }) => {
      const docs = await getDocsClient();
      const auth = await getAuthClient();

      log.info(
        `Downloading images from doc ${args.documentId}${args.tabId ? ` (tab: ${args.tabId})` : ''}`
      );

      let document: any;
      try {
        const res = await docs.documents.get({
          documentId: args.documentId,
          includeTabsContent: !!args.tabId,
          fields: args.tabId
            ? '*'
            : 'inlineObjects,positionedObjects',
        });
        document = res.data;
      } catch (error: any) {
        log.error(`Failed to fetch document: ${error.message || error}`);
        if (error.code === 404) throw new UserError(`Doc not found (ID: ${args.documentId}).`);
        if (error.code === 403)
          throw new UserError(`Permission denied for doc (ID: ${args.documentId}).`);
        throw new UserError(`Failed to read doc: ${error.message || 'Unknown error'}`);
      }

      const source = pickImageSource(document, args.tabId);
      if (!source) {
        throw new UserError(`Tab with ID "${args.tabId}" not found in document.`);
      }

      const images = collectImages(source, { imageObjectIds: args.imageObjectIds });
      if (images.length === 0) {
        return JSON.stringify(
          {
            documentId: args.documentId,
            tabId: args.tabId,
            count: 0,
            images: [],
            skipped: [],
            message: 'No images found.',
          },
          null,
          2
        );
      }

      const defaultDir = `images-${args.documentId}`;
      const requestedDir = args.saveDir ?? defaultDir;
      const resolvedDir = ensureWithinCwd(path.resolve(requestedDir));
      fs.mkdirSync(resolvedDir, { recursive: true });

      const usedNames = new Set<string>();
      const saved: Array<{
        objectId: string;
        kind: ImageKind;
        savedTo: string;
        mimeType: string;
        sizeBytes: number;
        sourceUri?: string;
      }> = [];
      const skipped: Array<{ objectId: string; reason: string }> = [];

      for (let i = 0; i < images.length; i++) {
        const img = images[i]!;
        try {
          const res = await auth.request<ArrayBuffer>({
            url: img.contentUri,
            method: 'GET',
            responseType: 'arraybuffer',
          });
          const contentTypeHeader = (res.headers as any)?.['content-type'] as string | undefined;
          const mimeType = extractContentType(contentTypeHeader);
          const ext = mimeToExtension(mimeType);
          const fileName = buildImageFileName(i, img.objectId, ext, usedNames);
          usedNames.add(fileName);
          const fullPath = path.join(resolvedDir, fileName);
          const buffer = Buffer.from(res.data as ArrayBuffer);
          fs.writeFileSync(fullPath, buffer);
          saved.push({
            objectId: img.objectId,
            kind: img.kind,
            savedTo: fullPath,
            mimeType,
            sizeBytes: buffer.length,
            sourceUri: img.sourceUri,
          });
          log.info(`Saved ${img.objectId} → ${fullPath} (${buffer.length} bytes)`);
        } catch (error: any) {
          const reason = error.message || 'Unknown error';
          log.error(`Failed to download ${img.objectId}: ${reason}`);
          skipped.push({ objectId: img.objectId, reason });
        }
      }

      return JSON.stringify(
        {
          documentId: args.documentId,
          tabId: args.tabId,
          savedTo: resolvedDir,
          count: saved.length,
          images: saved,
          skipped,
        },
        null,
        2
      );
    },
  });
}
