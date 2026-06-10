import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { checkRateLimit, recordUsage } from '@/src/lib/rate-limit';

function makeRequest(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/items?category=newsletters', {
    headers: { 'x-forwarded-for': ip },
  });
}

describe('rate limiting for /api/items', () => {
  it('is enrolled in RATE_LIMITS (finite remaining quota)', async () => {
    const result = await checkRateLimit(makeRequest('10.0.0.1'), '/api/items');
    expect(result.allowed).toBe(true);
    expect(Number.isFinite(result.remaining)).toBe(true);
  });

  it('blocks after the hourly limit is exhausted', async () => {
    const req = makeRequest('10.0.0.2');
    const first = await checkRateLimit(req, '/api/items');
    expect(first.allowed).toBe(true);

    for (let i = 0; i < first.remaining; i++) {
      await recordUsage(req, '/api/items');
    }

    const blocked = await checkRateLimit(req, '/api/items');
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toBeTruthy();
  });

  it('tracks client IPs independently', async () => {
    const blockedIp = makeRequest('10.0.0.2'); // exhausted above
    const freshIp = makeRequest('10.0.0.3');
    expect((await checkRateLimit(blockedIp, '/api/items')).allowed).toBe(false);
    expect((await checkRateLimit(freshIp, '/api/items')).allowed).toBe(true);
  });
});
