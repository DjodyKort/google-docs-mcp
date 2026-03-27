import { Firestore } from '@google-cloud/firestore';
import type { TokenStorage } from 'fastmcp/auth';

const COLLECTION = 'mcp-oauth-tokens';

/**
 * Firestore-backed TokenStorage for FastMCP's OAuth proxy.
 * Tokens survive container restarts and redeployments.
 * On Cloud Run, authentication is automatic via the service account.
 */
export class FirestoreTokenStorage implements TokenStorage {
  private db: Firestore;

  constructor(projectId?: string) {
    this.db = new Firestore({ projectId });
  }

  async save(key: string, value: unknown, ttl?: number): Promise<void> {
    const doc = this.db.collection(COLLECTION).doc(encodeKey(key));
    const data: Record<string, unknown> = { value, createdAt: Date.now() };
    if (ttl) {
      data.expiresAt = Date.now() + ttl * 1000;
    }
    await doc.set(data);
  }

  async get(key: string): Promise<unknown | null> {
    const doc = await this.db.collection(COLLECTION).doc(encodeKey(key)).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    if (data.expiresAt && Date.now() > (data.expiresAt as number)) {
      await this.delete(key);
      return null;
    }
    return data.value;
  }

  async delete(key: string): Promise<void> {
    await this.db.collection(COLLECTION).doc(encodeKey(key)).delete();
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const expired = await this.db
      .collection(COLLECTION)
      .where('expiresAt', '<=', now)
      .limit(500)
      .get();
    const batch = this.db.batch();
    expired.docs.forEach((doc) => batch.delete(doc.ref));
    if (!expired.empty) await batch.commit();
  }
}

function encodeKey(key: string): string {
  return key.replace(/\//g, '__');
}
