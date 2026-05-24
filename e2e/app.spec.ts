import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:65432';

test.describe('REST API', () => {
  test('GET /api/v1/health returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });

  test('GET /api/v1/mappings returns empty list initially', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/mappings`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.mappings)).toBe(true);
  });

  test('POST /api/v1/mappings creates a mapping', async ({ request }) => {
    const res = await request.post(`${BASE}/api/v1/mappings`, {
      data: {
        name: 'e2e-test',
        sourceHost: '127.0.0.1',
        sourcePort: 19999,
        targetHost: '127.0.0.1',
        targetPort: 20000,
        enabled: false,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('e2e-test');
    expect(body.sourcePort).toBe(19999);

    // Cleanup
    await request.delete(`${BASE}/api/v1/mappings/${body.id}`);
  });

  test('CORS block: cross-origin request is rejected with 403', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/health`, {
      headers: { Origin: 'http://evil.example.com' },
    });
    expect(res.status()).toBe(403);
  });

  test('GET /api/v1/logs returns entries array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/logs`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThan(0);
  });
});

test.describe('Web UI (static serving)', () => {
  test('GET / redirects to /ui', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.url()).toContain('/ui');
  });

  test('GET /ui returns HTML with the React app entry point', async ({ request }) => {
    const res = await request.get(`${BASE}/ui`);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('<div id="root">');
    expect(body).toContain('/ui/assets/');
  });

  test('GET /ui/assets/*.js serves the bundled JS', async ({ request }) => {
    const html = await (await request.get(`${BASE}/ui`)).text();
    const match = /src="(\/ui\/assets\/[^"]+\.js)"/.exec(html);
    expect(match).not.toBeNull();
    const assetUrl = `${BASE}${match![1]}`;
    const jsRes = await request.get(assetUrl);
    expect(jsRes.status()).toBe(200);
    expect(jsRes.headers()['content-type']).toContain('javascript');
  });
});
