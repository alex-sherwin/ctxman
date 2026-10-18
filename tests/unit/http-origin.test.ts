import { describe, expect, it } from 'vitest';
import { checkOrigin } from '../../src/lib/http.ts';

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers });
}

async function expectForbidden(res: Response | null): Promise<void> {
  expect(res?.status).toBe(403);
  expect((await res?.json())?.error).toBe('forbidden-origin');
}

describe('checkOrigin', () => {
  const url = new URL('http://localhost:4321/api/doc/kb/ctxman/main.md');

  it('passes a request without an Origin header', () => {
    expect(checkOrigin(req(url.href), url)).toBeNull();
  });

  it('passes the same origin', () => {
    expect(checkOrigin(req(url.href, { origin: 'http://localhost:4321' }), url)).toBeNull();
  });

  it('passes 127.0.0.1 against a localhost url (built server rebuilds the url with localhost)', () => {
    expect(checkOrigin(req(url.href, { origin: 'http://127.0.0.1:4321' }), url)).toBeNull();
  });

  it('passes every loopback spelling against every other loopback spelling', () => {
    const hosts = ['127.0.0.1', 'localhost', '[::1]'];
    for (const a of hosts) {
      for (const b of hosts) {
        const target = new URL(`http://${b}:4321/api/x`);
        expect(checkOrigin(req(target.href, { origin: `http://${a}:4321` }), target)).toBeNull();
      }
    }
  });

  it('fails a foreign origin', async () => {
    await expectForbidden(checkOrigin(req(url.href, { origin: 'http://evil.test' }), url));
    await expectForbidden(checkOrigin(req(url.href, { origin: 'http://evil.test:4321' }), url));
  });

  it('fails the null origin and an unparsable origin', async () => {
    await expectForbidden(checkOrigin(req(url.href, { origin: 'null' }), url));
    await expectForbidden(checkOrigin(req(url.href, { origin: 'not a url' }), url));
  });

  it('fails a loopback origin on another port', async () => {
    await expectForbidden(checkOrigin(req(url.href, { origin: 'http://127.0.0.1:4322' }), url));
  });

  it('fails a loopback origin with another protocol', async () => {
    await expectForbidden(checkOrigin(req(url.href, { origin: 'https://127.0.0.1:4321' }), url));
  });

  it('fails a non-loopback origin whose hostname differs, even with the same port', async () => {
    const remote = new URL('http://example.com:4321/api/x');
    await expectForbidden(
      checkOrigin(req(remote.href, { origin: 'http://evil.test:4321' }), remote),
    );
    await expectForbidden(
      checkOrigin(req(remote.href, { origin: 'http://127.0.0.1:4321' }), remote),
    );
  });

  it('passes when the Host header equals the Origin host:port', () => {
    const lan = new URL('http://localhost:4321/api/x');
    const request = req(lan.href, {
      origin: 'http://192.168.1.20:4321',
      host: '192.168.1.20:4321',
    });
    expect(request.headers.get('host')).toBe('192.168.1.20:4321');
    expect(checkOrigin(request, lan)).toBeNull();
  });

  it('fails when the Host header differs from the Origin host:port', async () => {
    const lan = new URL('http://localhost:4321/api/x');
    const request = req(lan.href, { origin: 'http://evil.test', host: '192.168.1.20:4321' });
    await expectForbidden(checkOrigin(request, lan));
  });

  it('uses the url protocol for the Host comparison', async () => {
    const lan = new URL('https://localhost:4321/api/x');
    const request = req(lan.href, {
      origin: 'http://192.168.1.20:4321',
      host: '192.168.1.20:4321',
    });
    await expectForbidden(checkOrigin(request, lan));
  });
});
