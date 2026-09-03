import { startTestServer } from '../node/helpers/test-server.js';
import { test, expect } from './helpers/app-fixture.js';

const AUTH_PASSWORD = 'playwright-secret';

test.describe('password auth', () => {
  let app;

  test.beforeAll(async () => {
    app = await startTestServer({
      auth: {
        password: AUTH_PASSWORD,
        strategy: 'password',
      },
    });
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test.beforeEach(async ({ page }) => {
    const governanceReset = await page.request.post(`${app.baseUrl}/api/test/reset-governance-state`);
    if (!governanceReset.ok()) {
      throw new Error(`reset-governance-state failed: ${governanceReset.status()} ${await governanceReset.text()}`);
    }
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-user-name', 'Playwright User');
    });
  });

  test('requires a password before opening the editor and preserves the session across reloads', async ({ page }) => {
    await page.goto(`${app.baseUrl}/#file=test.md`);

    await expect(page.locator('.auth-gate-card')).toBeVisible();
    await expect(page.locator('.auth-gate-secondary-button')).toHaveCount(0);
    await page.locator('.auth-gate-input').fill('wrong-password');
    await page.locator('.auth-gate-button').click();
    await expect(page.locator('.auth-gate-error')).toContainText('Incorrect password');

    await page.locator('.auth-gate-input').fill(AUTH_PASSWORD);
    await page.locator('.auth-gate-button').click();

    await expect(page.locator('.cm-editor')).toBeVisible();

    await page.reload();
    await expect(page.locator('.auth-gate-card')).toHaveCount(0);
    await expect(page.locator('.cm-editor')).toBeVisible();
  });

  test('requires a new login in a fresh browser context', async ({ browser }) => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-user-name', 'Fresh Context User');
    });

    await page.goto(app.baseUrl);
    await expect(page.locator('.auth-gate-card')).toBeVisible();

    await page.close();
  });

  test('accepts a shared password from the URL fragment and removes it after login', async ({ page }) => {
    await page.goto(`${app.baseUrl}/#auth_password=${AUTH_PASSWORD}&file=test.md`);

    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page.locator('.auth-gate-card')).toHaveCount(0);
    await expect(page).toHaveURL(/#file=test\.md$/);
  });
});

test.describe('oidc auth', () => {
  test('shows the Google login CTA, preserves the hash route, and syncs the Google identity', async ({ page }) => {
    let authenticated = false;
    let observedReturnTo = '';

    await page.route('**/app-config.js', async (route) => {
      await route.fulfill({
        body: `window.__COLLABMD_CONFIG__ = ${JSON.stringify({
          auth: {
            enabled: true,
            implemented: true,
            loginEndpoint: '/api/auth/oidc/login',
            provider: 'google',
            requiresLogin: true,
            sessionEndpoint: '/api/auth/session',
            statusEndpoint: '/api/auth/status',
            strategy: 'oidc',
            submitLabel: 'Continue with Google',
          },
          basePath: '',
          environment: 'test',
          gitEnabled: true,
          publicWsBaseUrl: '',
          wsBasePath: '/ws',
        })};\n`,
        contentType: 'text/javascript; charset=utf-8',
        status: 200,
      });
    });

    await page.route('**/api/auth/status', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          authenticated,
          auth: {
            enabled: true,
            implemented: true,
            loginEndpoint: '/api/auth/oidc/login',
            provider: 'google',
            requiresLogin: true,
            sessionEndpoint: '/api/auth/session',
            statusEndpoint: '/api/auth/status',
            strategy: 'oidc',
            submitLabel: 'Continue with Google',
          },
          user: authenticated
            ? {
              email: 'user@example.com',
              emailVerified: true,
              name: 'Google User',
              picture: 'https://example.com/avatar.png',
              sub: 'google-sub',
            }
            : null,
        }),
        contentType: 'application/json; charset=utf-8',
        status: 200,
      });
    });

    await page.route('**/api/auth/oidc/login?*', async (route) => {
      const url = new URL(route.request().url());
      observedReturnTo = url.searchParams.get('returnTo') || '';
      authenticated = true;
      await route.fulfill({
        headers: {
          location: observedReturnTo || '/',
        },
        status: 302,
      });
    });

    await page.goto('/#file=README.md');

    await expect(page.locator('.auth-gate-card')).toBeVisible();
    await expect(page.locator('.auth-gate-secondary-button')).toHaveCount(0);
    await expect(page.locator('.auth-gate-button')).toHaveText('Continue with Google');
    await expect(page.locator('.auth-gate-button__icon img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect.poll(async () => page.locator('.auth-gate-button__icon img').evaluate((node) => (
      node instanceof HTMLImageElement ? node.naturalWidth : 0
    ))).toBeGreaterThan(0);
    await page.locator('.auth-gate-button').click();

    await expect(page.locator('.cm-editor')).toBeVisible();
    await expect(page).toHaveURL(/#file=README\.md$/);
    await expect.poll(async () => observedReturnTo).toBe('/#file=README.md');
    await expect.poll(async () => (
      page.evaluate(() => window.localStorage.getItem('collabmd-user-name'))
    )).toBe('Google User');
    await expect(page.locator('#displayNameDialog')).toBeHidden();
    await expect(page.locator('#editNameBtn')).toBeHidden();
    const currentParticipant = page.locator('#participantBar [data-self="true"]');
    await expect(currentParticipant).toBeVisible();
    await expect(currentParticipant.locator('.participant-name')).toHaveText('Google User');
    await expect(currentParticipant).toHaveAttribute('data-participant-kind', 'human');
    await expect(currentParticipant).toHaveAttribute('data-grant-state', 'active');
    await expect(currentParticipant).toContainText('Owner');
    await expect(currentParticipant).toContainText('You');
    await expect(page.locator('#currentUserName')).toHaveCount(0);
  });
});
