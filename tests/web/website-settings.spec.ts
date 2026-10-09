/* Author: ramanpal singh | URL: https://kwebby.com */
import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import yazl from 'yazl';
import type { WebsiteSettings } from '../../packages/contracts/src/website.js';
import { paceApiRequests } from './network-pacing.js';

type DemoAccess = { password: string; accounts: { email: string; roles: string[] }[] };
type SettingsRecord = { id: string; key: string; version: number; value: WebsiteSettings };
type PublishedSite = { url: string; website?: WebsiteSettings; theme?: { publicationId?: string; themeId?: string; manifest?: Record<string, unknown> } };
const fixture = resolve(process.env.DEMO_ACCESS_FILE || '.runtime/demo-access.json');
const access: DemoAccess | null = existsSync(fixture) ? JSON.parse(readFileSync(fixture, 'utf8')) : null;
const editor = '/workspace/website';
const savedMessage = 'Website draft saved. Review the preview, then activate a theme to publish this revision.';

// Use browser fetch for setup/cleanup too, so the shared request pacing remains effective.
async function api<T>(page: Page, path: string, csrf = '', method = 'GET', body?: unknown): Promise<T> {
  const result = await page.evaluate(async ({ path, csrf, method, body }) => {
    const response = await fetch(`/api/v1${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const envelope = await response.json();
    return { status: response.status, ok: response.ok, data: envelope.data, code: envelope.error?.code };
  }, { path, csrf, method, body });
  // Do not include response bodies or private fixture/session data in failure output.
  expect(result.ok, `${method} ${path} returned HTTP ${result.status} (${result.code || 'no error code'})`).toBeTruthy();
  return result.data as T;
}

async function login(page: Page) {
  const owner = access?.accounts.find(account => account.roles.includes('owner'));
  if (!access || !owner) throw new Error('Seed an isolated fictional installation with an owner before running this test.');
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(access.password);
  const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/auth/login'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await response).ok(), 'Fictional owner sign-in failed').toBeTruthy();
  await page.waitForURL('**/workspace');
}

async function ensureLocalBaseline(page: Page, csrf: string): Promise<{ site: PublishedSite; created: boolean }> {
  const site = await api<PublishedSite>(page, '/public/site');
  if (site.theme?.publicationId) return { site, created: false };
  // The disposable local seed can start with a bootstrap theme but no immutable
  // publication. Create one baseline once; the API cannot restore publication absence.
  expect(['localhost', '127.0.0.1', '[::1]'], 'Baseline initialization is restricted to the local fictional fixture').toContain(new URL(page.url()).hostname);
  const themes = await api<{ id: string; status: string; scanStatus: string }[]>(page, '/records/themes');
  let themeId = themes.find(theme => theme.status === 'validated' && theme.scanStatus === 'clean')?.id;
  if (!themeId) {
    expect(site.theme?.manifest, 'Bootstrap theme manifest must be available').toBeTruthy();
    const archive = new yazl.ZipFile();
    archive.addBuffer(Buffer.from(JSON.stringify(site.theme!.manifest)), 'theme.json');
    archive.end();
    const chunks: Buffer[] = [];
    for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
    const encoded = Buffer.concat(chunks).toString('base64');
    const imported = await page.evaluate(async ({ encoded, csrf }) => {
      const form = new FormData();
      form.append('file', new Blob([Uint8Array.from(atob(encoded), character => character.charCodeAt(0))], { type: 'application/zip' }), 'fictional-baseline-theme.zip');
      const response = await fetch('/api/v1/themes/import', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf }, body: form });
      const result = await response.json();
      return { ok: response.ok, status: response.status, id: result.data?.id };
    }, { encoded, csrf });
    expect(imported.ok, `Real baseline theme scan/import returned HTTP ${imported.status}`).toBeTruthy();
    themeId = imported.id;
  }
  expect(themeId).toBeTruthy();
  await api(page, `/themes/${themeId}/activate`, csrf, 'POST', { expectedPublicationId: '' });
  return { site: await api<PublishedSite>(page, '/public/site'), created: true };
}

// Scope by the visible label span: wrapping textarea text can enter getByLabel's
// label-text matcher after hydration, while help text also belongs to the label.
const field = (page: Page, label: string) => page.locator('label.form-field')
  .filter({ has: page.locator('span').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\*)?$`) }) })
  .locator('input,textarea');
async function noModal(page: Page) {
  await expect(page.locator('dialog:modal,[role="dialog"]')).toHaveCount(0);
}
async function saveDraft(page: Page) {
  const response = page.waitForResponse(r => ['PATCH', 'POST'].includes(r.request().method()) && /\/api\/v1\/records\/settings(?:\/[^/?]+)?$/.test(r.url()), { timeout: 15_000 });
  await page.getByRole('button', { name: 'Save website draft', exact: true }).click();
  expect((await response).ok(), 'Website draft save failed').toBeTruthy();
  await expect(page.getByText(savedMessage, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save website draft', exact: true })).toBeDisabled();
  await noModal(page);
}
async function mobileScreenshot(page: Page, path: string, workspace = true) {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  if (workspace) await expect(page.getByRole('navigation', { name: 'Workspace navigation', exact: true })).not.toBeInViewport();
  await noModal(page);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1050 });
}

test.describe('website editor publication lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  test('saved clinic drafts stay private until activation and rollback restores the prior website', async ({ page, context }, testInfo) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    test.skip(!access, 'Seed a disposable fictional installation; local credentials remain private.');
    await paceApiRequests(context);
    const errors: string[] = [];
    const fontResponses: { url: string; status: number }[] = [];
    page.on('response', response => {
      if (/\/fonts\/(?:lora|source-sans-3)-.*\.woff2$/.test(new URL(response.url()).pathname)) {
        fontResponses.push({ url: response.url(), status: response.status() });
      }
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { errors.push(`Unexpected ${dialog.type()} dialog`); void dialog.dismiss(); });
    await login(page);
    const session = await api<{ csrfToken: string }>(page, '/auth/session');
    const baseline = await ensureLocalBaseline(page, session.csrfToken);
    const initialSite = baseline.site;
    if (baseline.created) testInfo.annotations.push({ type: 'fixture', description: 'Initialized a baseline publication in the local fictional seed. It remains after the test; original publication absence cannot be restored through the API.' });
    const initialRecord = (await api<SettingsRecord[]>(page, '/records/settings')).find(row => row.key === 'website');
    expect(initialRecord, 'Disposable seed must contain website settings for exact restoration').toBeTruthy();
    expect(initialSite.theme?.publicationId, 'Disposable seed must have an active publication for rollback').toBeTruthy();
    expect(initialSite.theme?.themeId, 'Disposable seed must have an activatable theme').toBeTruthy();
    const original = structuredClone(initialRecord!);
    const originalPublication = initialSite.theme!.publicationId!;
    const marker = `Fictional editor ${Date.now()}`;
    const heading = `${marker} care`;
    const button = `${marker} visit`;
    const locationName = `${marker} clinic`;
    const locationSlug = `locations/editor-${Date.now()}`;
    const canonicalPhone = '+911234567890';
    const displayPhone = '+91 12345 67890';
    const imageAlt = 'A fictional sage green square used to test public image descriptions';
    let publicationAttempted = false;
    let uploadedImage: { id: string; width: number; height: number; mime: string } | undefined;

    try {
      await page.goto(`${editor}/homepage`);
      await expect(page.getByRole('heading', { name: 'Homepage sections', exact: true })).toBeVisible();
      const setup = page.getByRole('button', { name: 'Set up editable homepage', exact: true });
      if (await setup.isVisible()) await setup.click();
      await page.locator('.website-section-list').getByRole('link', { name: 'Edit', exact: true }).first().click();
      await expect(page).toHaveURL(/\/workspace\/website\/homepage\/[^/]+$/);
      await page.getByRole('checkbox', { name: 'Show this section on the homepage', exact: true }).check();
      await field(page, 'Heading').fill(heading);
      await field(page, 'Text').fill('Fictional draft text checked before and after immutable website publication.');
      if (!await field(page, 'Button 1 label').count()) await page.getByRole('button', { name: 'Add button', exact: true }).click();
      await field(page, 'Button 1 label').fill(button);
      await field(page, 'Button 1 destination').fill('/booking');
      await field(page, 'Section image description').fill(imageAlt);
      // This reaches the actual upload endpoint and ClamAV scanner; no scan response is mocked.
      const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#25645d' } }).png().toBuffer();
      const imageResponse = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/v1/public-assets'));
      await page.getByLabel('Upload section image', { exact: true }).setInputFiles({ name: 'fictional-website-square.png', mimeType: 'image/png', buffer: png });
      const scanned = await imageResponse;
      expect(scanned.ok(), `Real scanned image upload returned HTTP ${scanned.status()}`).toBeTruthy();
      uploadedImage = (await scanned.json()).data;
      expect(uploadedImage).toMatchObject({ width: 40, height: 40, mime: 'image/webp' });
      await expect(page.getByText('Image scanned and ready. Save the website draft to keep this selection.', { exact: true })).toBeVisible();
      await saveDraft(page);
      await page.reload();
      await expect(field(page, 'Heading')).toHaveValue(heading);
      await expect(field(page, 'Button 1 label')).toHaveValue(button);
      await expect(page.getByRole('img', { name: imageAlt, exact: true })).toHaveAttribute('src', `/api/v1/public/assets/${uploadedImage!.id}`);
      await page.screenshot({ path: testInfo.outputPath('website-section-desktop.png'), fullPage: true, animations: 'disabled' });
      await mobileScreenshot(page, testInfo.outputPath('website-section-mobile.png'));

      await page.goto(`${editor}/branding`);
      await expect(page.getByRole('heading', { name: 'Colors, typography and logo', exact: true })).toBeVisible();
      await page.getByLabel('primary color', { exact: true }).fill('#164c4a');
      await page.getByRole('combobox', { name: 'Heading font', exact: true }).selectOption('lora');
      await page.getByRole('combobox', { name: 'Body font', exact: true }).selectOption('source-sans-3');
      await saveDraft(page);

      await page.goto(`${editor}/navigation`);
      await expect(page.getByRole('heading', { name: 'Header and footer', exact: true })).toBeVisible();
      if (!await field(page, 'Navigation 1 label').count()) await page.getByRole('button', { name: 'Add navigation link', exact: true }).click();
      await field(page, 'Navigation 1 label').fill(`${marker} directions`);
      await field(page, 'Navigation 1 destination').fill(`/${locationSlug}`);
      await field(page, 'Announcement').fill(`${marker} announcement`);
      await field(page, 'Footer description').fill(`${marker} public footer`);
      await saveDraft(page);

      await page.goto(`${editor}/locations`);
      await expect(page.getByRole('heading', { name: 'Locations and local SEO', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Add clinic location', exact: true }).click();
      await expect(page).toHaveURL(/\/workspace\/website\/locations\/[^/]+$/);
      await field(page, 'Public clinic name').fill(locationName);
      await field(page, 'Location page path').fill(locationSlug);
      await field(page, 'Canonical phone').fill(canonicalPhone);
      await field(page, 'Display phone').fill(displayPhone);
      await field(page, 'Street address').fill('12 Fictional Test Walk');
      await field(page, 'City / locality').fill('Fictional Test City');
      await field(page, 'Postal code').fill('000000');
      await field(page, 'Country code').fill('IN');
      await field(page, 'IANA timezone').fill('Asia/Kolkata');
      await page.getByRole('checkbox', { name: 'Use as primary public location', exact: true }).check();
      for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
        await page.getByRole('combobox', { name: `${day} schedule`, exact: true }).selectOption(['Saturday', 'Sunday'].includes(day) ? 'closed' : 'open');
      }
      await page.getByLabel('Monday opens', { exact: true }).fill('08:30');
      await page.getByLabel('Monday closes', { exact: true }).fill('18:00');
      await field(page, 'Parking and transport').fill('Fictional test parking beside the entrance.');
      await field(page, 'Accessibility information').fill('Fictional test step-free entrance.');
      await page.getByRole('button', { name: 'Add special date', exact: true }).click();
      await field(page, 'Exception 1 date').fill('2030-01-01');
      await field(page, 'Exception 1 description').fill('Fictional test closure');
      await saveDraft(page);
      await mobileScreenshot(page, testInfo.outputPath('website-location-mobile.png'));

      await page.goto(`${editor}/seo`);
      await expect(page.getByRole('heading', { name: 'SEO and social defaults', exact: true })).toBeVisible();
      // Preserve the installation's pinned canonical origin, instead of changing its host.
      await expect(field(page, 'Canonical HTTPS origin')).toHaveValue(original.value.origin);
      await field(page, 'Default search description').fill(`${marker} search description`);
      await field(page, 'Default social image URL').fill(`/api/v1/public/assets/${uploadedImage!.id}`);
      await field(page, 'Social image description').fill(imageAlt);
      await field(page, 'Search Console verification code').fill(`fictional-${Date.now()}`);
      await saveDraft(page);

      await page.goto(`${editor}/preview`);
      await expect(page.getByRole('heading', { name: 'Preview and publish', exact: true })).toBeVisible();
      const preview = page.locator('.website-preview-viewport');
      await expect(preview.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(preview.getByRole('link', { name: button, exact: true })).toHaveAttribute('href', '/booking');
      await expect(preview.locator('.public-site')).toHaveCSS('--site-primary', '#164c4a');
      await page.getByRole('button', { name: 'Mobile', exact: true }).click();
      await expect(preview).toHaveClass(/mobile/);
      await page.screenshot({ path: testInfo.outputPath('website-draft-preview.png'), fullPage: true, animations: 'disabled' });
      await mobileScreenshot(page, testInfo.outputPath('website-preview-mobile.png'));

      const draftSite = await api<PublishedSite>(page, '/public/site');
      expect(draftSite.theme?.publicationId).toBe(originalPublication);
      expect(draftSite.website).toEqual(initialSite.website);
      const beforePublish = await page.request.get('/');
      expect(beforePublish.ok()).toBeTruthy();
      expect(await beforePublish.text()).not.toContain(marker);
      expect((await page.request.get(`/${locationSlug}`)).status()).toBe(404);

      publicationAttempted = true;
      const publication = await api<{ id: string }>(page, `/themes/${initialSite.theme!.themeId}/activate`, session.csrfToken, 'POST', { expectedPublicationId: originalPublication });
      expect(publication.id).not.toBe(originalPublication);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: button, exact: true })).toHaveAttribute('href', '/booking');
      await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: `${marker} directions`, exact: true })).toHaveAttribute('href', `/${locationSlug}`);
      await expect(page.locator('.public-contact-bar')).toContainText('12 Fictional Test Walk');
      await expect(page.locator('.public-contact-bar a')).toHaveAttribute('href', `tel:${canonicalPhone}`);
      await expect(page.locator('.public-footer')).toContainText(displayPhone);
      await expect(page.locator('.public-site')).toHaveCSS('--site-primary', '#164c4a');
      await expect(page.locator('.public-site')).toHaveCSS('font-family', /Source Sans 3/);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCSS('font-family', /Lora/);
      const fontsLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return { lora: document.fonts.check('16px Lora'), sourceSans: document.fonts.check('16px "Source Sans 3"') };
      });
      expect(fontsLoaded).toEqual({ lora: true, sourceSans: true });
      for (const family of ['lora', 'source-sans-3']) {
        expect(fontResponses.some(response => new URL(response.url).pathname.startsWith(`/fonts/${family}-`) && response.status === 200), `${family} must load a real local font successfully`).toBeTruthy();
      }
      expect(fontResponses.every(response => new URL(response.url).origin === new URL(page.url()).origin)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath('website-published-desktop.png'), fullPage: true, animations: 'disabled' });
      await mobileScreenshot(page, testInfo.outputPath('website-published-mobile.png'), false);

      const locationResponse = await page.goto(`/${locationSlug}`);
      expect(locationResponse?.status()).toBe(200);
      const serverHtml = await locationResponse!.text();
      expect(serverHtml).toContain(locationName);
      expect(serverHtml).toContain('12 Fictional Test Walk');
      expect(serverHtml).toContain(canonicalPhone);
      expect(serverHtml).toContain('08:30');
      await expect(page.getByRole('heading', { name: locationName, exact: true })).toBeVisible();
      await expect(page.locator('.location-details address')).toContainText('12 Fictional Test Walk');
      await expect(page.locator('.opening-hours')).toContainText('08:30–18:00');
      await expect(page.locator('.opening-hours')).toContainText('SundayClosed');
      // Deployment public URL is authoritative for canonical/schema/social URLs.
      const canonicalLocation = new URL(`/${locationSlug}`, initialSite.url).href;
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonicalLocation);
      expect(serverHtml).toContain(canonicalLocation);
      expect(serverHtml).toContain('application/ld+json');
      const socialImage = new URL(`/api/v1/public/assets/${uploadedImage!.id}`, initialSite.url).href;
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', socialImage);
      await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute('content', imageAlt);
      await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', socialImage);
      expect(serverHtml).toContain(socialImage);
      const schemaNodes = await page.locator('script[type="application/ld+json"]').evaluateAll(scripts => {
        const nodes: Record<string, unknown>[] = [];
        const visit = (value: unknown) => {
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === 'object') {
            const node = value as Record<string, unknown>;
            if (node['@type']) nodes.push(node);
            Object.values(node).forEach(visit);
          }
        };
        scripts.forEach(script => visit(JSON.parse(script.textContent || '{}')));
        return nodes;
      });
      const clinic = schemaNodes.find(node => node['@type'] === 'MedicalClinic' && node.url === canonicalLocation);
      expect(clinic).toMatchObject({ name: locationName, telephone: canonicalPhone, address: { '@type': 'PostalAddress', streetAddress: '12 Fictional Test Walk', addressLocality: 'Fictional Test City', postalCode: '000000', addressCountry: 'IN' } });
      expect(clinic?.openingHoursSpecification).toEqual(expect.arrayContaining([{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/Monday', opens: '08:30', closes: '18:00' }]));
      expect(clinic?.openingHoursSpecification).toHaveLength(5);
      expect(clinic?.specialOpeningHoursSpecification).toEqual(expect.arrayContaining([{ '@type': 'OpeningHoursSpecification', validFrom: '2030-01-01', validThrough: '2030-01-01', opens: '00:00', closes: '00:00' }]));
      const sitemap = await page.request.get('/sitemaps/pages.xml');
      expect(sitemap.ok()).toBeTruthy();
      const sitemapXml = await sitemap.text();
      expect(sitemapXml).toContain(`<loc>${canonicalLocation}</loc>`);
      const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
      expect(sitemapUrls.length).toBeGreaterThan(0);
      expect(sitemapUrls.every(url => new URL(url).origin === new URL(initialSite.url).origin)).toBeTruthy();
      await mobileScreenshot(page, testInfo.outputPath('website-public-location-mobile.png'), false);
      expect(errors).toEqual([]);
    } finally {
      // Restore the immutable publication first; a failed editor assertion must not leave test content live.
      try {
        if (publicationAttempted) {
          const current = await api<PublishedSite>(page, '/public/site');
          if (current.theme?.publicationId !== originalPublication) {
            const restored = await api<{ id: string }>(page, '/themes/rollback', session.csrfToken, 'POST', { expectedPublicationId: current.theme?.publicationId });
            expect(restored.id, 'Rollback must restore the exact previous publication').toBe(originalPublication);
          }
        }
      } finally {
        const current = await api<SettingsRecord>(page, `/records/settings/${original.id}`);
        await api(page, `/records/settings/${original.id}`, session.csrfToken, 'PATCH', { key: 'website', value: original.value, expectedVersion: current.version });
      }
      const restoredSite = await api<PublishedSite>(page, '/public/site');
      expect(restoredSite.theme?.publicationId).toBe(originalPublication);
      expect(restoredSite.website).toEqual(initialSite.website);
      const restoredSettings = await api<SettingsRecord>(page, `/records/settings/${original.id}`);
      expect(restoredSettings.value).toEqual(original.value);
      expect(await (await page.request.get('/')).text()).not.toContain(marker);
      expect((await page.request.get(`/${locationSlug}`)).status()).toBe(404);
      // The isolated scanner-created asset remains unreferenced; settings/publication are restored.
    }
  });
});
