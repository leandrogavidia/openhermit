import { randomUUID } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import pg from 'pg';

import type { PolicyStore } from '../interfaces.js';
import type { PolicyRecord } from '../types.js';
import * as schema from '../schema.js';
import { agentPolicies } from '../schema.js';
import type { DrizzleDb } from './index.js';

const nullCondition = (col: any, value: string | undefined | null) =>
  value ? eq(col, value) : sql`${col} IS NULL`;

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
    opts?: { sandboxAlias?: string; mode?: string },
  ): Promise<PolicyRecord | undefined> {
    const rows = await this.db
      .select()
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.agentId, agentId),
          eq(agentPolicies.resourceType, resourceType),
          eq(agentPolicies.resourceKey, resourceKey),
          nullCondition(agentPolicies.sandboxAlias, opts?.sandboxAlias),
          nullCondition(agentPolicies.mode, opts?.mode),
        ),
      )
      .limit(1);

    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async upsert(
    input: Omit<PolicyRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PolicyRecord> {
    const now = new Date().toISOString();
    const existing = await this.get(
      input.agentId,
      input.resourceType,
      input.resourceKey,
      { ...(input.sandboxAlias ? { sandboxAlias: input.sandboxAlias } : {}), ...(input.mode ? { mode: input.mode } : {}) },
    );

    if (existing) {
      await this.db
        .update(agentPolicies)
        .set({ grants: input.grants, updatedAt: now })
        .where(eq(agentPolicies.id, existing.id));
      return { ...existing, grants: input.grants, updatedAt: now };
    }

    const row = {
      id: randomUUID(),
      agentId: input.agentId,
      sandboxAlias: input.sandboxAlias,
      resourceType: input.resourceType,
      mode: input.mode,
      resourceKey: input.resourceKey,
      grants: input.grants,
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
    opts?: { sandboxAlias?: string; mode?: string },
  ): Promise<void> {
    await this.db
      .delete(agentPolicies)
      .where(
        and(
          eq(agentPolicies.agentId, agentId),
          eq(agentPolicies.resourceType, resourceType),
          eq(agentPolicies.resourceKey, resourceKey),
          nullCondition(agentPolicies.sandboxAlias, opts?.sandboxAlias),
          nullCondition(agentPolicies.mode, opts?.mode),
        ),
      );
  }
}

function toRecord(row: typeof agentPolicies.$inferSelect): PolicyRecord {
  return {
    id: row.id,
    agentId: row.agentId,
    sandboxAlias: row.sandboxAlias,
    resourceType: row.resourceType,
    mode: row.mode,
    resourceKey: row.resourceKey,
    grants: row.grants ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
