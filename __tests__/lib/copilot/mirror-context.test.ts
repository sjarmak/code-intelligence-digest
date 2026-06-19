import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  _assertLocalUrlForTests as assertLocalUrl,
  _MirrorCopilotDbContextForTests as MirrorCtx,
} from '@/src/lib/copilot/mirror-context';
import { NOMIC_EMBED } from '@/src/lib/embeddings/provenance';

function nomicVec(): number[] {
  const v = new Array(NOMIC_EMBED.dimensions).fill(0);
  v[0] = 1;
  return v;
}

describe('semanticSearchByVector (nomic curation path, dv0.5.4)', () => {
  it('queries item_model_embeddings scoped to the nomic model', async () => {
    const queryMock = vi.fn().mockResolvedValue({ rows: [] });
    const ctx = new MirrorCtx({ query: queryMock } as unknown as Pool);
    await ctx.semanticSearchByVector(nomicVec(), 5);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('FROM item_model_embeddings');
    expect(sql).toContain('e.model_name = $1');
    expect(sql).toContain('e.embedding_normalized = TRUE');
    expect(sql).toContain('e.embedding <=> $2::vector');
    expect(params[0]).toBe(NOMIC_EMBED.model);
    expect(params[2]).toBe(5); // capped limit
    expect(sql).not.toContain('item_embeddings e'); // not the OpenAI table
  });

  it('rejects a wrong-dimension vector (guards against the OpenAI 1536d space)', async () => {
    const ctx = new MirrorCtx({ query: vi.fn() } as unknown as Pool);
    await expect(ctx.semanticSearchByVector(new Array(1536).fill(0.1), 5)).rejects.toThrow(
      `${NOMIC_EMBED.dimensions}-dim`,
    );
  });
});

describe('assertLocalUrl', () => {
  it('accepts localhost', () => {
    expect(() =>
      assertLocalUrl('postgres://u:p@localhost:5433/code_intel')
    ).not.toThrow();
  });

  it('accepts 127.0.0.1', () => {
    expect(() =>
      assertLocalUrl('postgres://u:p@127.0.0.1:5433/code_intel')
    ).not.toThrow();
  });

  it('accepts *.local hostnames', () => {
    expect(() =>
      assertLocalUrl('postgres://u:p@dev.local:5432/code_intel')
    ).not.toThrow();
  });

  it('rejects remote hosts', () => {
    expect(() =>
      assertLocalUrl('postgres://u:p@db.render.com/code_intel')
    ).toThrow(/not local/);
  });

  it('rejects IPv4 addresses that are not 127.x', () => {
    expect(() =>
      assertLocalUrl('postgres://u:p@10.0.0.5:5432/code_intel')
    ).toThrow(/not local/);
  });
});
