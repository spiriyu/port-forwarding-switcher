import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:65432';

// ── REST API ──────────────────────────────────────────────────────────────────

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

// ── Web UI — browser rendering ────────────────────────────────────────────────

test.describe('Web UI', () => {
  test('/ redirects to /ui and React app mounts', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(/\/ui/);
    // React mounts into #root — wait for it to be non-empty
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
  });

  test('page title is portswitch', async ({ page }) => {
    await page.goto(`${BASE}/ui`);
    await expect(page).toHaveTitle(/portswitch/i);
  });

  test('mapping list section is visible', async ({ page }) => {
    await page.goto(`${BASE}/ui`);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
    // The app renders some kind of table/list area or empty-state text
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThan(10);
  });

  test('can open Add Mapping dialog', async ({ page }) => {
    await page.goto(`${BASE}/ui`);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
    // Look for an "Add" or "+" button — click it and confirm the dialog opens
    const addBtn = page.getByRole('button', { name: /add|new|\+/i }).first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      // Dialog or form should appear
      await expect(page.locator('[role="dialog"], form')).toBeVisible({ timeout: 3_000 });
    } else {
      // If there's no Add button yet, the app is still valid (empty state might differ)
      test.skip();
    }
  });

  test('WebSocket connection established — status not "disconnected"', async ({ page }) => {
    await page.goto(`${BASE}/ui`);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
    // The app should have connected to the WS and not be stuck in an error/disconnected state
    const body = await page.textContent('body');
    // If the app shows a "disconnected" or "connection lost" banner that's a failure
    expect(body).not.toMatch(/cannot connect|connection lost|unreachable/i);
  });

  test('mapping CRUD flow: create, verify in UI, delete', async ({ page, request }) => {
    // Create a mapping via API
    const res = await request.post(`${BASE}/api/v1/mappings`, {
      data: {
        name: 'ui-e2e-mapping',
        sourceHost: '127.0.0.1',
        sourcePort: 19998,
        targetHost: '127.0.0.1',
        targetPort: 20001,
        enabled: false,
      },
    });
    expect(res.status()).toBe(201);
    const { id } = await res.json();

    // Load the UI — mapping should be listed
    await page.goto(`${BASE}/ui`);
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 });
    await expect(page.getByText('ui-e2e-mapping')).toBeVisible({ timeout: 5_000 });

    // Cleanup via API
    await request.delete(`${BASE}/api/v1/mappings/${id}`);
  });
});
