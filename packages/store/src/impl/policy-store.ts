import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';

import type { PolicyStore } from '../interfaces.js';
import type { PolicyRecord } from '../types.js';
import * as schema from '../schema.js';
import { agentPolicies } from '../schema.js';
import type { DrizzleDb } from './index.js';

export class DbPolicyStore implements PolicyStore {
  private pool?: pg.Pool;

  constructor(private readonly db: DrizzleDb) {}

  static async open(databaseUrl?: string): Promise<DbPolicyStore> {
    const url = databaseUrl ?? process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL environment variable is required');
    const pool = new pg.Pool({ connectionString: url });
    await pool.query('SELECT 1');
    const db = drizzle(pool, { schema });
    const store = new DbPolicyStore(db);
    store.pool = pool;
    return store;
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }

  async list(agentId: string, resourceType?: string): Promise<PolicyRecord[]> {
    const conditions = resourceType
      ? and(eq(agentPolicies.agentId, agentId), eq(agentPolicies.resourceType, resourceType))
      : eq(agentPolicies.agentId, agentId);

    const rows = await this.db.select().from(agentPolicies).where(conditions);
    return rows.map(toRecord);
  }

  async get(
    agentId: string,
    resourceType: string,
    resourceKey: string,
  ): Promise<PolicyRecord | undefined> {
    const rows = await this.db
      .select()
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.agentId, agentId),
          eq(agentPolicies.resourceType, resourceType),
          eq(agentPolicies.resourceKey, resourceKey),
        ),
      )
      .limit(1);

    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async upsert(
    input: Omit<PolicyRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PolicyRecord> {
    const now = new Date().toISOString();
    const existing = await this.get(input.agentId, input.resourceType, input.resourceKey);

    if (existing) {
      await this.db
        .update(agentPolicies)
        .set({ grants: input.grants, scope: input.scope, updatedAt: now })
        .where(eq(agentPolicies.id, existing.id));
      return { ...existing, grants: input.grants, scope: input.scope, updatedAt: now };
    }

    const row = {
      id: randomUUID(),
      agentId: input.agentId,
      resourceType: input.resourceType,
      resourceKey: input.resourceKey,
      grants: input.grants,
      scope: input.scope,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(agentPolicies).values(row);
    return toRecord(row);
  }

  async delete(
    agentId: string,
    resourceType: string,
    resourceKey: string,
  ): Promise<void> {
    await this.db
      .delete(agentPolicies)
      .where(
        and(
          eq(agentPolicies.agentId, agentId),
          eq(agentPolicies.resourceType, resourceType),
          eq(agentPolicies.resourceKey, resourceKey),
        ),
      );
  }
}

function toRecord(row: typeof agentPolicies.$inferSelect): PolicyRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    resourceType: row.resourceType,
    resourceKey: row.resourceKey,
    grants: row.grants ?? [],
    scope: (row.scope ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
