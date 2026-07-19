import { afterEach, describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import {
  UNATTRIBUTED_CLIENT_IP,
  resolveClientIP,
  trustedProxyHops,
} from '@/src/lib/rate-limit';

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest('http://localhost/api/items', { headers });
}

describe('resolveClientIP', () => {
  it('takes the hop the trusted proxy appended, not the client-supplied prefix', () => {
    // Render's LB appends the real peer IP to whatever the client sent, so with
    // one trusted hop the rightmost entry is the only trustworthy one.
    const req = makeRequest({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' });
    expect(resolveClientIP(req, 1)).toBe('203.0.113.7');
  });

  it('is not spoofable: rotating the client-supplied prefix keeps one bucket', () => {
    const a = resolveClientIP(makeRequest({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }), 1);
    const b = resolveClientIP(makeRequest({ 'x-forwarded-for': '2.2.2.2, 203.0.113.7' }), 1);
    const c = resolveClientIP(makeRequest({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4, 203.0.113.7' }), 1);
    expect(new Set([a, b, c]).size).toBe(1);
    expect(a).toBe('203.0.113.7');
  });

  it('honours a deeper trusted-proxy chain', () => {
    const req = makeRequest({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7, 10.0.0.1' });
    expect(resolveClientIP(req, 2)).toBe('203.0.113.7');
  });

  it('shares one conservative bucket when the chain is shorter than the trusted hops', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.7' });
    expect(resolveClientIP(req, 2)).toBe(UNATTRIBUTED_CLIENT_IP);
  });

  it('shares one conservative bucket when no forwarding header is present', () => {
    expect(resolveClientIP(makeRequest({}), 1)).toBe(UNATTRIBUTED_CLIENT_IP);
  });

  it('ignores x-real-ip, which no trusted hop guarantees', () => {
    // Kept as its own case: the old fallback let a header-setting client mint a
    // private bucket whenever it simply omitted x-forwarded-for.
    expect(resolveClientIP(makeRequest({ 'x-real-ip': '203.0.113.7' }), 1)).toBe(
      UNATTRIBUTED_CLIENT_IP
    );
  });

  it('rejects a hop that is not a valid IP rather than keying a bucket on junk', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.7, not-an-ip' });
    expect(resolveClientIP(req, 1)).toBe(UNATTRIBUTED_CLIENT_IP);
  });

  it('rejects out-of-range IPv4 octets', () => {
    expect(resolveClientIP(makeRequest({ 'x-forwarded-for': '999.1.1.1' }), 1)).toBe(
      UNATTRIBUTED_CLIENT_IP
    );
  });

  it('strips the port a proxy may append', () => {
    expect(resolveClientIP(makeRequest({ 'x-forwarded-for': '203.0.113.7:41234' }), 1)).toBe(
      '203.0.113.7'
    );
    expect(resolveClientIP(makeRequest({ 'x-forwarded-for': '[2001:db8::1]:41234' }), 1)).toBe(
      '2001:db8::1'
    );
  });

  it('accepts a bare IPv6 hop', () => {
    expect(resolveClientIP(makeRequest({ 'x-forwarded-for': '2001:db8::1' }), 1)).toBe(
      '2001:db8::1'
    );
  });

  it('trusts no header at all when zero hops are configured', () => {
    expect(resolveClientIP(makeRequest({ 'x-forwarded-for': '203.0.113.7' }), 0)).toBe(
      UNATTRIBUTED_CLIENT_IP
    );
  });

  it('falls back to one trusted hop when the configured value is not a valid count', () => {
    const req = makeRequest({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' });
    expect(resolveClientIP(req, Number.NaN)).toBe('203.0.113.7');
    expect(resolveClientIP(req, -3)).toBe('203.0.113.7');
  });
});

describe('trustedProxyHops', () => {
  afterEach(() => {
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  it('defaults to the single Render load-balancer hop when unset', () => {
    expect(trustedProxyHops()).toBe(1);
  });

  it('reads an explicit count', () => {
    process.env.TRUSTED_PROXY_HOPS = '2';
    expect(trustedProxyHops()).toBe(2);
  });

  it('honours an explicit 0 (trust no forwarding header)', () => {
    process.env.TRUSTED_PROXY_HOPS = '0';
    expect(trustedProxyHops()).toBe(0);
  });

  it('treats a blank value as unset, not as 0', () => {
    // An env UI writes '' for a cleared field. Number('') is a valid 0, which
    // would silently funnel every client into the shared bucket.
    process.env.TRUSTED_PROXY_HOPS = '';
    expect(trustedProxyHops()).toBe(1);
    process.env.TRUSTED_PROXY_HOPS = '   ';
    expect(trustedProxyHops()).toBe(1);
  });

  it('leaves garbage for resolveClientIP to reject, which falls back to 1 hop', () => {
    process.env.TRUSTED_PROXY_HOPS = 'abc';
    const req = makeRequest({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' });
    expect(resolveClientIP(req, trustedProxyHops())).toBe('203.0.113.7');
  });
});
