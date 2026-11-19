import { expect, test } from '@playwright/test';

const PROD = 'http://localhost:5180';

test('production build runs under the production CSP without violations', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // The deliberate probes below log network errors; only count other console errors.
    if (
      m.type() === 'error' &&
      !/127\.0\.0\.1:47998|example\.com|Content Security Policy|Failed to fetch|ERR_CONNECTION_REFUSED/.test(
        m.text(),
      )
    )
      errors.push(m.text());
  });

  const res = await page.goto(PROD);
  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  await expect(page.getByRole('button', { name: /create project/i })).toBeVisible();

  // Self-hosted fonts load under font-src 'self'.
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('700 16px Inter') && document.fonts.check('400 16px "Bebas Neue"');
  });
  expect(fontsOk).toBe(true);

  // The assistant bridge on the user's own loopback is allowed (connection refused here is fine)…
  await page.evaluate(() =>
    fetch('http://127.0.0.1:47998/connect', { method: 'POST' }).catch(() => null),
  );
  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations).toEqual([]);

  // …but any other destination is still blocked by the policy.
  await page.evaluate(() => fetch('https://example.com/').catch(() => null));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.length))
    .toBe(1);
  expect(errors).toEqual([]);
});
