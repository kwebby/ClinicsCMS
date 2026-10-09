<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Building themes and custom website structures

ClinicsCMS separates portable design packages, a clinic's website settings, and trusted application code. This guide documents the implementation in this repository, including its current limits. Start with [installation](INSTALLATION.md) and the [website settings guide](WEBSITE-SETTINGS.md) if you are setting up a clinic rather than developing a theme.

## Choose the right customization method

| Need | Use | Requires rebuilding the application? |
|---|---|---|
| Change headings, text, images, buttons, cards, FAQs or section order | Website settings → Homepage | No |
| Set a logo, colors, Google font family, spacing or width | Website settings → Branding | No |
| Edit navigation, announcement, booking link or footer | Website settings → Navigation | No |
| Edit locations, phone, address, hours, maps and accessibility details | Website settings → Locations | No |
| Write a service, article, education or other public page | Pages and its BlockNote editor | No |
| Share a reusable baseline layout and palette between installations | Format-v1 theme ZIP | No |
| Add a new rendering behavior, page layout engine, custom widget or data source | Application source extension reviewed with schema, permissions and tests | Yes |

Theme ZIPs contain data and vetted assets. They cannot contain React components, JavaScript, CSS, HTML, templates that execute code, server plugins, database credentials or arbitrary remote-resource URLs. Clinical, administrative, portal and payment interfaces remain application-owned.

## Precedence and publication

The public homepage uses saved-and-published `website.homepage.sections` when configured; otherwise it uses the active theme's `layouts.home`. It does **not** merge the two arrays. Published branding overrides the theme tokens. Published website navigation overrides theme navigation, including when the saved navigation array is deliberately empty. The application always owns the header/footer frame, routes, metadata, schemas and data access.

Use **Website settings → Homepage → Use theme homepage layout instead** and **Branding → Use theme design defaults** when you want to remove those overrides. Save the website draft and publish again. These changes are explicit; uploading a theme does not discard clinic edits.

There are three different operations:

1. **Save a draft:** saves editable website settings or a page draft. It does not activate a website publication.
2. **Create/import a theme:** scans and validates an immutable theme record. A designer edit creates another version rather than changing the existing record.
3. **Activate/publish:** atomically binds a validated theme, public business/website settings, and approved page snapshots. Publishing includes all eligible page snapshots, not just the page you most recently edited. Review the pending content first.

Rollback restores the previous publication binding and those captured settings/page snapshots. Current operational service/clinician lists are projected from the database, and public assets are separately stored; a publication is not a complete historical database or file backup. Retain referenced theme assets and publication files. See [recovery](security/RECOVERY.md).

## Starter projects

The repository includes [minimal](../examples/themes/minimal/theme.json) and [community](../examples/themes/community/theme.json) examples. The first has no assets. The second has six homepage blocks and an original geometric illustration.

Copy one to a working folder outside its parent examples collection:

```sh
mkdir -p .runtime/my-theme
cp -R examples/themes/community/. .runtime/my-theme/
```

Update `name`, `slug`, `version`, `description`, `author` and `license`, then edit the layout and palette. The author field in supplied examples preserves `ramanpal singh | https://kwebby.com`. JSON does not support comment headers; keep author attribution in the allowed field and retain applicable license notices in your distribution.

## ZIP directory structure

```text
my-theme.zip
├── theme.json
└── assets/
    ├── clinic-welcome.png
    └── portraits/
        └── clinician.jpg
```

`theme.json` must be at the archive root. Do not zip a parent folder containing the manifest. Only the manifest and supported files under `assets/` are accepted. Keep README files, full license texts, Photoshop/Figma sources, `.DS_Store`, `__MACOSX`, `.git`, `node_modules` and build scripts outside the upload directory. Files ending in `.svg`, `.gif`, `.ttf`, `.otf`, `.css`, `.js`, `.html`, `.pdf`, `.txt` or `.zip` are rejected.

Path names are case-sensitive. Use ASCII letters, digits, underscores and hyphens in asset names/directories, with lowercase allowed extensions. Avoid additional dots in an asset basename: `hero.v2.png` is rejected by the archive allowlist; `hero-v2.png` is accepted. No absolute paths, backslashes, empty segments, `.`/`..`, links or duplicate entries are permitted.

## Complete minimal manifest

```json
{
  "formatVersion": 1,
  "name": "My clinic theme",
  "slug": "my-clinic-theme",
  "version": "1.0.0",
  "description": "A simple clinic website",
  "author": "ramanpal singh | https://kwebby.com",
  "license": "MIT",
  "tokens": {
    "primary": "#176A5A",
    "secondary": "#E2F1EA",
    "background": "#FFFFFF",
    "text": "#18362E",
    "muted": "#546A63",
    "radius": 12,
    "fontFamily": "sans",
    "baseFontSize": 16,
    "maxWidth": 1200
  },
  "layouts": {
    "home": [
      { "id": "welcome", "type": "hero", "variant": "split", "heading": "Welcome to our clinic", "text": "Find services and arrange your next visit." },
      { "id": "care", "type": "services", "heading": "Our services" },
      { "id": "visit", "type": "contact", "heading": "Plan your visit" }
    ],
    "page": [],
    "article": [],
    "service": [],
    "doctor": [],
    "contact": [],
    "tool": []
  },
  "navigation": [
    { "label": "Services", "href": "/services" },
    { "label": "Contact", "href": "/contact" }
  ]
}
```

The canonical schema is [`themeManifestSchema`](../packages/platform/src/themes.ts). Unknown object properties are rejected. Keep all seven layout keys, including empty arrays: the current Zod enum record requires them.

### Manifest fields

| Field | Type and constraints |
|---|---|
| `formatVersion` | Exactly the integer `1`; schema compatibility version, distinct from theme release version |
| `name` | Nonempty string, at most 100 characters |
| `slug` | At most 80 lowercase letters/digits and single separating hyphens, such as `community-care` |
| `version` | Three numeric components, such as `1.0.0`; prerelease suffixes are not accepted |
| `description` | At most 500 characters; defaults to empty string |
| `author` | At most 120 characters; defaults to empty string |
| `license` | Required, nonempty, at most 120 characters; an identifier/label, not a full license document |
| `tokens` | Required strict token object described below |
| `layouts` | Required `home`, `page`, `article`, `service`, `doctor`, `contact`, `tool` arrays; at most 40 blocks per array |
| `navigation` | At most 20 `{label, href}` items; defaults to an empty array |
| `preview` | Optional supported image path under `assets/`; the referenced file must exist |

Use a new theme version when distributing a changed package. The designer increments the patch version when you customize an existing theme. Imports get distinct immutable record IDs; the server does not enforce global uniqueness of a theme's slug/version pair. Do not treat those strings as a cryptographic identity. ZIP and individual asset SHA-256 values provide integrity checks.

### Design tokens

| Token | Accepted value | Purpose |
|---|---|---|
| `primary` | Six-digit hex, e.g. `#176A5A` | Main accent and primary controls |
| `secondary` | Six-digit hex | Secondary surfaces/accent |
| `background` | Six-digit hex | Public page background |
| `text` | Six-digit hex | Main text |
| `muted` | Six-digit hex | Secondary text |
| `radius` | Number, 0–32 | Corner radius in pixels |
| `fontFamily` | `system`, `sans`, `serif` | Baseline font category; current serif fallback is Georgia |
| `baseFontSize` | Integer, 14–22 | Base size in pixels |
| `maxWidth` | Integer, 960–1600 | Maximum content width in pixels |

There is no free CSS field. Short hex, alpha colors, gradients, arbitrary `url()` values and custom CSS selectors are not accepted. Check contrast at actual text sizes and at mobile widths. Stored tokens are limited to application-exposed properties; individual components may use their own spacing rules.

### Format-v1 layout blocks

Every block has `id` and `type`. Its optional fields are `variant` (defaults to `default`), `heading` (up to 160 characters), `text` (up to 2,000 characters) and `image`. IDs use the same slug syntax as a theme slug and should be unique within each layout. The current ZIP schema does not itself enforce block-ID uniqueness, so authors must avoid duplicates.

Variants are `default`, `split`, `centered` and `compact`. Acceptance does not mean every block renders four visibly different arrangements. The application controls which variant classes affect each component.

| ZIP type | Current homepage behavior |
|---|---|
| `hero` | Heading/text and fixed booking/services calls to action; optional package image; clinic illustration otherwise |
| `services` | Intro and current public service list with fees and booking links |
| `doctors` | Intro and current public clinician list with booking links |
| `article` | Heading/text and the homepage's published BlockNote content |
| `faq` | Heading/text and the homepage's published BlockNote content; no dedicated FAQ array in ZIP v1 |
| `contact` | Clinic contact/visit block and fixed visit-preparation link |
| `tool` | Heading and a fixed link to visit tools |
| `cta` | Heading/text and a fixed appointment link |
| `testimonials` | Accepted by the v1 schema but **not rendered** by the legacy homepage renderer; use website settings for testimonials |
| `footer` | Ignored as a homepage block; the application renders one shared footer |

Only `layouts.home` is currently read by the public page renderer. The six other layout arrays are portable schema slots, not an implemented per-page rendering system. Inner pages use the trusted route in [`app/[...slug]/page.tsx`](../apps/web/app/[...slug]/page.tsx), plus BlockNote and application-owned directory/location components. Adding a `service` or `doctor` block layout in JSON does not change those pages.

The ZIP `image` field is currently displayed on a legacy hero only. Its alt text is the generic “Clinic.” For page-specific accessible descriptions, additional images and editable buttons use website settings. The `preview` image is validated/stored but the current theme library draws a sample layout rather than displaying that image.

### Navigation

Each ZIP navigation item has a nonempty `label` of at most 60 characters and a same-site `href` beginning with a single `/`. Only letters, digits, slashes, underscores and hyphens are accepted after that slash. For example, `/services`, `/contact` and `/patient-resources` work. External links, query strings, fragments, `tel:` and `mailto:` do not belong in ZIP navigation.

Website settings navigation is deliberately richer and allows validated HTTPS, local, telephone and email links. A theme link does not create its destination page: publish that page separately or use an existing application route.

## Images, fonts and licensing

Accepted raster formats are PNG, JPEG and WebP. The server checks file signatures, decodes each image, rejects multi-frame images and images above 40 million pixels, and re-encodes it in the same format before storing it. Re-encoding removes EXIF/GPS and other metadata, colour-profile chunks and any bytes appended after the image, and applies EXIF orientation; JPEG and WebP are re-compressed at quality 90, so exported theme assets are the re-encoded files rather than your originals. Keep actual dimensions and file sizes reasonable for mobile delivery, and still avoid placing patient information in the visible image.

WOFF2 files are permitted as assets; their header is validated (signature, font flavor, declared length equal to the file size, table count, reserved field and block bounds), but ZIP v1 has no font-family mapping and does not automatically create `@font-face` rules. Including a font file alone will not make it selectable or active. Use the built-in locally hosted Google Fonts library in Branding. Its nine curated families include their OFL notices, source URLs and hashes in [`apps/web/public/fonts`](../apps/web/public/fonts/README.md).

Keep asset rights separate from theme code rights. The `license` string does not automatically grant permission to use a photo, a clinic logo or a commercial typeface. The supplied example illustration is original and MIT-licensed with this repository. Uploaded ZIPs cannot contain `.txt` license files under the current allowlist; distribute full license and attribution documents alongside your ZIP or in its source repository. Do not package third-party assets if their terms cannot be satisfied by your distribution.

## Package and validate

Install project dependencies and a working ClamAV daemon first. The script uses the same validator and scanner as the API, and fails if scanning is unavailable. See [dependencies](DEPENDENCIES.md) and [deployment](../deploy/README.md).

```sh
pnpm theme:package pack .runtime/my-theme .runtime/theme-builds/my-clinic-theme-1.0.0.zip
pnpm theme:package check .runtime/theme-builds/my-clinic-theme-1.0.0.zip
```

If using a non-default ClamAV configuration:

```sh
CLAMD_CONFIG=/absolute/path/to/clamd.conf pnpm theme:package check .runtime/theme-builds/my-clinic-theme-1.0.0.zip
```

`pack` walks only regular supported files, rejects symlinks, checks source limits, writes a ZIP with the manifest at its root, runs malware/ZIP/manifest/asset checks and then creates the output. It never overwrites an existing output or writes it inside the source directory. It uses stored ZIP entries to avoid accidental expansion-ratio failures; optimize image bytes if the ZIP is too large. `check` verifies an existing archive without modifying it. Neither command uploads, publishes, calls the application database or activates anything. API upload always scans again.

A successful command prints the manifest name/version, file count, byte count and archive SHA-256. A scan result describes that scan, not a security certification. It does not prove copyright ownership, accessibility, clinical accuracy or compatibility with unimplemented renderer behavior.

### Exact upload limits

| Limit | Value |
|---|---|
| Archive bytes | Greater than zero, at most 25 MiB (26,214,400 bytes) |
| Expanded bytes | At most 100 MiB (104,857,600 bytes) |
| Entries | At most 1,000, including directory entries |
| Individual file | At most 20 MiB (20,971,520 bytes) |
| Manifest | At most 128 KiB (131,072 bytes) |
| Expansion ratio | At most 100:1 per file |
| Path length | At most 200 characters for files |
| Image dimensions | At most 40 million pixels |

The application rejects encrypted ZIPs, archive bombs, missing references, duplicate paths, MIME/extension mismatches, nested archives and unsupported data. Unknown manifest keys are errors. For example, `customCss`, `scripts` or `buttons` inside a v1 ZIP block fail validation rather than being silently executed or ignored.

## Import, preview, activation and rollback

Owners, administrators and content editors can manage themes.

1. Open `/workspace/themes/upload` and select the validated ZIP.
2. Wait for scanning and validation. Failure leaves the current published website unchanged.
3. Review the dedicated theme preview page. This is a **sample-content design preview**; it does not display imported hero photos, all real content or website-settings overrides.
4. Review `/workspace/website/preview` for the saved clinic content and current theme using the shared public components. This page previews the current active theme; there is no full unpublished-candidate-theme staging route yet. Test a new package with real content in an isolated staging installation before live activation.
5. Activate the chosen theme from its preview page. The expected-publication value protects against overwriting another editor's newer publication. A conflict requires refreshing and reviewing again.
6. Check the public homepage, service/team/contact pages, booking links, mobile view, image accessibility and canonical/social metadata.
7. Use **Restore previous publication** on the theme library to roll back. It moves to the previous binding rather than rewriting files or reverting the whole database. Retain exports/backups when you need longer-term recovery.

**Customize** downloads an existing theme's assets, increments its patch version and opens the designer. The designer can change identity, token values, section order/headings/text/variants and navigation. It preserves existing assets but does not provide a new ZIP-image upload control; edit the source package for that or use website settings images. **Export ZIP** exports the theme manifest/assets only. Clinic homepage overrides, canonical locations, public-image asset records, pages and private data are not included.

Relevant REST routes are below. All protected mutations require the normal authenticated cookie, CSRF token and permitted origin; use the UI unless building a trusted integration. Do not put session tokens in a shared script.

| Method | Route | Operation |
|---|---|---|
| POST | `/api/v1/themes/import` | Multipart field `file`; scan and create immutable theme |
| GET | `/api/v1/themes/:id/preview` | Authorized theme metadata |
| GET | `/api/v1/themes/:id/export` | Authorized ZIP export |
| POST | `/api/v1/themes/:id/activate` | Activate with `expectedPublicationId` |
| POST | `/api/v1/themes/rollback` | Restore previous binding with `expectedPublicationId` |
| GET | `/api/v1/public/themes/:id/assets/*path` | Asset from the currently active theme only |

## Editable homepage sections are a separate contract

[`packages/contracts/src/website.ts`](../packages/contracts/src/website.ts) defines the website editor's 13 types: `hero`, `trust`, `services`, `about`, `doctors`, `process`, `pricing`, `testimonials`, `locations`, `faq`, `resources`, `lead-tool` and `cta`. They are not interchangeable with the ten ZIP-v1 types. For example, ZIP `contact` corresponds broadly to website `locations`, and ZIP `tool` to website `lead-tool`, but there is no automatic converter.

Website settings support up to 20 sections, one enabled hero, unique section IDs, `enabled`, the four variants, an introductory `eyebrow`, a 160-character heading, 4,000-character text, a scanned public-asset image, at most two buttons, up to 12 cards, up to 20 FAQ items and up to 30 selected source IDs. Cards and FAQ items have unique IDs within their lists. Buttons have labels up to 80 characters and validated destinations. Images require asset IDs and nonempty alt text; they are not arbitrary filesystem or ZIP paths. The complete settings payload is capped at 200 KiB.

Automatic services, clinicians and resources appear when those sections have no custom cards. Resources are restricted to public medical/article pages and show up to six entries. Locations reuse canonical branch records. A `lead-tool` section links to an existing tool; it does not install a new AI model or tool. The common card/FAQ fields are rendered when populated, but each specialized section's automatic source behavior is application-owned.

This is an illustrative website-settings section, **not** a valid `theme.json` block or a separate upload format:

```json
{
  "id": "visit-steps",
  "type": "process",
  "enabled": true,
  "variant": "default",
  "heading": "Your visit, step by step",
  "text": "Here is what to expect when arranging your appointment.",
  "cards": [
    { "id": "request", "heading": "Request a visit", "text": "Choose a service and contact our reception team." },
    { "id": "prepare", "heading": "Prepare", "text": "Bring the information your clinic requests." }
  ],
  "buttons": [
    { "label": "Arrange an appointment", "href": "/booking", "style": "primary" }
  ]
}
```

## Add a custom application section safely

First check whether a current card, process, FAQ, resource or CTA section expresses the need. For example, an insurance-information section can usually be a `trust` or `pricing` section with cards, avoiding a new stored type.

For a genuinely new behavior, such as an application-owned accessibility-services directory:

1. Add a bounded type and fields to `SECTION_CATALOG` and `websiteSectionSchema` in `packages/contracts/src/website.ts`. Keep the module browser-safe, reject unknown fields, and specify defaults/migration behavior for older records.
2. Add the editor UI in `apps/web/components/website-editor-pages.tsx` and related field components. Use dedicated page flows, accessible labels and the existing draft/conflict handling. Do not add arbitrary-code fields.
3. Add rendering to `apps/web/components/website-sections.tsx`. Keep the renderer usable by both server-rendered pages and the authenticated preview. Render text as React text; do not introduce unsanitized `dangerouslySetInnerHTML`. Add responsive styles to `website-public.css`.
4. If the section uses new data, define a minimal public projection in the API. Authorize reads, enforce organization/branch boundaries and public visibility, and keep private clinical/contact details out of the public response. Never access the database directly from a browser component.
5. If the section references assets, extend `websiteAssetIds` and the server's ownership/clean-scan validation. Use the public asset service; do not point public images at private patient storage.
6. Decide which values belong in the publication snapshot. Extend the explicit allowlists in `ThemeService.activate` and the public controller if new root settings are introduced. Preserve immutable revisions and rollback behavior. Do not make newly saved drafts publicly visible before activation.
7. Add focused tests for valid/invalid inputs, permissions, cross-organization assets, draft privacy, publication/rollback and server-rendered output. Exercise editing, reload/conflict handling and mobile rendering in Playwright.
8. Run type checks, targeted tests and a production build, then install the new application release on every target installation before using the new type there.

If you also need the feature in portable ZIPs, extend the **separate** manifest schema, theme designer, legacy renderer, sample preview, exporter and ZIP tests. Use a new format version for breaking semantics and provide an explicit migration; the existing literal `formatVersion: 1` rejects unrecognized formats. Do not simply widen validators while leaving rendering or authorization undefined.

Use the existing pattern of a shared schema and trusted renderer for custom inner-page structures too. There is currently no executable plugin loader or arbitrary theme template language. A custom Next.js route is an application change: it must preserve public metadata, private-page exclusion, access controls and deployment builds.

## Troubleshooting

| Symptom | Check |
|---|---|
| `THEME_MANIFEST` | Valid JSON, no comments/trailing commas, every layout key present, only known properties, valid numeric/string bounds |
| `THEME_FILE` / unsupported file | Only root `theme.json` and supported assets; no parent folder, hidden OS files or license text inside ZIP |
| `THEME_PATH` | Safe ASCII path, no traversal/backslash/extra dots in basenames |
| `THEME_ASSET` | Referenced file exists with exact case; file signature matches extension |
| `THEME_IMAGE` | Valid decodable single-frame PNG/JPEG/WebP, pixel budget respected, and still within 20 MiB after re-encoding |
| `THEME_BOMB` / `THEME_SIZE` | Optimize media, reduce entry count/expanded bytes, avoid extreme compression ratios |
| `FILE_SCAN_FAILED` | ClamAV daemon/signatures/configuration reachable; inspect operational logs without exposing upload content |
| `VERSION_CONFLICT` | Another publication changed; reload and review rather than retrying with a guessed ID |
| Theme activates but homepage does not change | Website homepage/branding/navigation overrides take precedence |
| Non-home layout changes do nothing | Inner-page layout arrays are not consumed by the current renderer |
| New image absent from sample preview | Current theme preview uses an illustration; validate in isolated staging with real content |
| Included WOFF2 is not used | ZIP v1 has no font mapping; select the local library in Branding |
| Old theme asset URL returns 404 | Public asset route permits only the active theme; use authorized export for inactive packages |

For broader internals see [architecture](ARCHITECTURE.md), [API contracts](API-CONTRACT.md) and [security theme format](security/THEME-FORMAT.md).
