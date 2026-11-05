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
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  const res = await page.goto(PROD);
  expect(res?.headers()['content-security-policy']).toContain("default-src 'self'");
  await expect(page.getByRole('button', { name: /create project/i })).toBeVisible();

  // Self-hosted fonts load under font-src 'self'.
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('700 16px Inter') && document.fonts.check('400 16px "Bebas Neue"');
  });
  expect(fontsOk).toBe(true);

  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
