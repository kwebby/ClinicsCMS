/* Author: ramanpal singh | URL: https://kwebby.com */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { paceApiRequests } from './network-pacing.js';

type DemoAccess = { password: string; accounts: { name: string; email: string; roles: string[] }[] };
const fixture = resolve(process.env.DEMO_ACCESS_FILE || '.runtime/demo-access.json');
const access: DemoAccess | null = existsSync(fixture) ? JSON.parse(readFileSync(fixture, 'utf8')) : null;
test.beforeEach(async ({ context }) => { await paceApiRequests(context); });

async function login(page: Page, context: BrowserContext, role: string) {
  if (!access) throw new Error('Seed the isolated fictional demonstration before this test.');
  const account = access.accounts.find((a) => a.roles.includes(role));
  if (!account) throw new Error(`Fictional ${role} account is missing.`);
  await context.clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(access.password);
  const signedIn = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/auth/login'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const response = await signedIn;
  expect(response.ok(), `Fictional ${role} sign-in returned HTTP ${response.status()}`).toBeTruthy();
  await page.waitForURL(role === 'patient' ? '**/portal' : '**/workspace');
}
const noPopup = (page: Page) => expect(page.locator('dialog:modal')).toHaveCount(0);
async function openAction(page: Page, label: string, action: string) {
  await page.getByRole('link', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/actions/${action.replaceAll('.', '\\.')}$`));
  await expect(page.getByRole('heading', { name: label, exact: true, level: 1 })).toBeVisible();
  await noPopup(page);
}
async function backToList(page: Page, title: string) {
  await page.getByRole('link', { name: `Back to ${title.toLowerCase()}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
  await noPopup(page);
}

test('public pages include SSR search/social metadata, schema, private exclusions and responsive layout', async ({ page, request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBeTruthy();
  const html = await response.text();
  expect(html).toContain('application/ld+json');
  expect(html).toContain('MedicalClinic');
  expect(html).toContain('property="og:title"');
  expect(html).toContain('name="twitter:card"');
  expect(html).toContain('rel="canonical"');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  const sitemap = await request.get('/sitemaps/pages.xml');
  const xml = await sitemap.text();
  expect(xml).toContain('<urlset');
  expect(xml).not.toMatch(/<loc>[^<]*\/(workspace|portal|login|register|setup|checkout)/);
  const privatePage = await request.get('/workspace');
  expect(privatePage.headers()['x-robots-tag']).toContain('noindex');
  expect(privatePage.headers()['cache-control']).toContain('no-store');
  expect((await request.get('/api/v1/records/patients')).status()).toBe(401);
  expect((await request.get('/this-route-does-not-exist-e2e')).status()).toBe(404);
});

test('patient preparation tool produces a useful result without collecting email', async ({ page }) => {
  await page.goto('/tools/visit-preparation');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Create|Generate|Build|Prepare/i }).first().click();
  await expect(page.locator('.tool-result')).toBeVisible();
  await expect(page.locator('.tool-result')).toContainText(/visit|appointment|prepare/i);
  expect(await page.getByRole('checkbox').last().isChecked()).toBeFalsy();
});

test('staff record, invoice, payment, publication, clinical signature and patient portal flow', async ({ page, context }, testInfo) => {
  test.skip(!access, 'Run pnpm seed:demo against an isolated disposable database; credentials stay in .runtime/demo-access.json.');
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const run = Date.now();
  const name = `Fictional E2E Patient ${run}`;
  await login(page, context, 'owner');
  await expect(page.getByRole('link', { name: 'Consultations', exact: true })).toHaveCount(0);
  await page.goto('/workspace/patients');
  await page.getByRole('link', { name: 'New patient', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace\/patients\/new$/);
  await noPopup(page);
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email', { exact: true }).fill(`e2e-${run}@example.invalid`);
  await page.getByRole('button', { name: 'Save patient', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/workspace\/patients\/[A-Za-z0-9_-]+$/);
  await noPopup(page);
  await backToList(page, 'Patients');

  await page.goto('/workspace/invoices');
  await page.getByRole('link', { name: 'New invoice', exact: true }).click();
  await page.getByLabel('Patient', { exact: false }).selectOption({ label: name });
  await page.getByLabel('Currency').fill('USD');
  await page.getByLabel('description item 1').fill('Fictional E2E consultation');
  await page.getByLabel('unitPrice item 1').fill('125.00');
  await page.getByRole('button', { name: 'Save invoice', exact: true }).click();
  await openAction(page, 'Issue invoice', 'invoices.issue');
  await page.getByRole('button', { name: 'Issue invoice', exact: true }).click();
  await expect(page.locator('.detail-meta .status')).toHaveText('issued');
  await openAction(page, 'Record payment', 'payments.record');
  await page.getByLabel('Amount', { exact: false }).fill('125.00');
  await page.getByLabel('Payment method').selectOption('cash');
  await page.getByLabel('Payment reference').fill(`Fictional E2E ${run}`);
  await page.getByRole('button', { name: 'Record payment', exact: true }).last().click();
  await expect(page.locator('.detail-meta .status')).toHaveText('paid');
  await backToList(page, 'Invoices');

  const title = `Fictional E2E article ${run}`;
  const slug = `guides/e2e-${run}`;
  await page.goto('/workspace/pages');
  await page.getByRole('link', { name: 'New page', exact: true }).click();
  await page.getByLabel('Page title').fill(title);
  await page.getByLabel('URL slug').fill(slug);
  await page.locator('.bn-editor').click();
  await page.keyboard.type('A fictional test of BlockNote editing and server-rendered publication.');
  await page.getByLabel('Search description').fill('A fictional verification page for the clinic CMS.');
  await page.getByRole('button', { name: 'Save page', exact: true }).click();
  await openAction(page, 'Publish page', 'pages.publish');
  await page.getByRole('button', { name: 'Publish page', exact: true }).click();
  await expect(page.locator('.detail-meta .status')).toHaveText('published');
  const publishedPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Load version history', exact: true }).click();
  await page.getByRole('link', { name: 'View revision', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${publishedPath}/revisions/[A-Za-z0-9_-]+$`));
  await expect(page.getByRole('heading', { level: 1, name: /^Version \d+$/ })).toBeVisible();
  await noPopup(page);
  const revisionPath = new URL(page.url()).pathname;
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${revisionPath}$`));
  await expect(page.getByRole('heading', { level: 1, name: /^Version \d+$/ })).toBeVisible();
  await page.goto(publishedPath);
  await expect(page.locator('.detail-meta .status')).toHaveText('published');
  await page.goto('/workspace/themes');
  // Wait for the asynchronous theme/publication lookup before choosing the publish path.
  await expect(page.locator('.theme-grid, .empty-state')).toBeVisible();
  const publish = page.getByRole('button', { name: 'Publish website', exact: true });
  if (await publish.count()) {
    await publish.click();
    await expect(page.getByText('Website published with the latest page and settings revisions.')).toBeVisible();
  }
  await page.goto('/' + slug);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'A fictional verification page for the clinic CMS.');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(slug + '$'));

  await login(page, context, 'doctor');
  await page.goto('/workspace/encounters');
  await page.getByRole('link', { name: 'New consultation', exact: true }).click();
  await page.getByLabel('Patient', { exact: false }).selectOption({ label: name });
  await page.getByLabel('Doctor', { exact: false }).selectOption({ label: access!.accounts.find((a) => a.roles.includes('doctor'))!.name });
  await page.locator('.bn-editor').click();
  await page.keyboard.type('Fictional E2E clinical note. No real patient information.');
  await page.getByRole('button', { name: 'Save consultation', exact: true }).click();
  await openAction(page, 'Sign consultation', 'encounters.sign');
  await page.getByRole('button', { name: 'Sign consultation', exact: true }).click();
  await expect(page.locator('.detail-meta .status')).toHaveText('signed');
  await expect(page.getByRole('link', { name: 'Edit consultation', exact: true })).toHaveCount(0);
  await backToList(page, 'Consultations');
  await page.goto('/workspace');
  await page.screenshot({ path: testInfo.outputPath('doctor-workspace.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('mobile-workspace.png'), fullPage: true });
  await login(page, context, 'patient');
  await expect(page.getByRole('heading', { name: /Hello,/ })).toBeVisible();
  await page.getByRole('link', { name: 'Documents', exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/documents$/);
  await noPopup(page);
  await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
