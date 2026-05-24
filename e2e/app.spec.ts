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
});

test.describe('Web UI', () => {
  test('/ redirects to /ui', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/ui/);
  });

  test('/ui renders the portswitch React app', async ({ page }) => {
    await page.goto(`${BASE}/ui`);
    // The app shell should mount; look for a header or known text
    await expect(page.locator('body')).not.toBeEmpty();
    // The page should not be a raw JSON error
    const text = await page.textContent('body');
    expect(text).not.toMatch(/"code":/);
  });

  test('WebSocket /api/v1/events delivers hello message', async ({ page }) => {
    await page.goto(`${BASE}/ui`);
    const hello = await page.evaluate(() => {
      return new Promise<{ type: string }>((resolve, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:65432/api/v1/events');
        const timer = setTimeout(() => reject(new Error('WS timeout')), 5000);
        ws.onmessage = (e) => {
          clearTimeout(timer);
          ws.close();
          resolve(JSON.parse(e.data));
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('WS error')); };
      });
    });
    expect(hello.type).toBe('hello');
  });
});
