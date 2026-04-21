import { describe, expect, it } from 'vitest';
import { _assertLocalUrlForTests as assertLocalUrl } from '@/src/lib/copilot/mirror-context';

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
