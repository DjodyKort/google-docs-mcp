import { gmail_v1 } from 'googleapis';

export function findHeaderValue(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string | null {
  if (!headers) return null;
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}
