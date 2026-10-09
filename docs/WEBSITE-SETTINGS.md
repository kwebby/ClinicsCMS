<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS website settings and local discovery

Open **Website settings** in the workspace, or `/workspace/website/homepage`. Owners, administrators and content editors can use these controls. Content editors can change website settings without access to business, payroll or integration settings.

These controls are available after [installation](INSTALLATION.md) and account setup. They edit the clinic’s own public identity; the ClinicsCMS workspace brand does not overwrite its name or search titles. For a reusable ZIP package or a new application-owned component, see [theme development](THEME-DEVELOPMENT.md).

## Research and recommended structure

The [24-clinic research report](../artifacts/research/clinic-sites-2026-10/README.md) records official homepages, ordered sections, calls to action, observed imagery metadata, navigation, other-page inventories, sitemap declarations and NAP observations. The sample covers 12 countries/markets. Counts describe observed patterns, not conversion effectiveness or search rankings. Sitemap totals are distinct from verified live-page counts.

The starter homepage has nine slots:

1. Welcome and booking.
2. Services.
3. Clinic introduction and care benefits.
4. Care team.
5. Patient experiences.
6. Fees and payment options.
7. Locations and opening hours.
8. Questions and answers.
9. Closing appointment invitation.

Introduction, testimonials, fees and FAQ slots start hidden until content is supplied. The complete library contains 13 section types: hero, trust, services, about, doctors, process, pricing, testimonials, locations, FAQ, resources, lead tool and CTA. Up to 20 sections can be ordered, hidden and edited. Headers and footers are separate.

## Dedicated editing pages

| Page | Controls |
|---|---|
| `/workspace/website/homepage` | Section order, visibility and additions; each section has its own edit URL |
| `/workspace/website/branding` | Five colors, contrast guidance, logo, heading/body fonts, text size, corner radius and content width |
| `/workspace/website/navigation` | Announcement, booking button, patient portal visibility, ordered navigation, footer text and links |
| `/workspace/website/locations` | Canonical branch NAP, hours, special dates, maps/profile links, coordinates, parking, accessibility and CSV reference |
| `/workspace/website/seo` | Website identity, description, locale, share image, social handles and Search Console verification |
| `/workspace/website/preview` | Current-draft desktop/mobile preview and the theme publishing workflow |

Section forms support headings, introductory labels, plain text, image/alt text, two buttons, cards with images and links, FAQs, and automatic selections from public services, clinicians, resources and locations. The page-content editor continues to use BlockNote for long-form content, citations and medical review. Custom cards replace automatic service/team/resource lists. Links allow local paths, HTTPS, telephone and email destinations; arbitrary scripts, HTML and CSS are not accepted.

Public image uploads require descriptions and use the real malware scanner plus safe image decoding/re-encoding. Private patient files cannot be selected as public images. Upload completion preserves edits made while scanning; saving is disabled during an active upload.

## Fonts

The searchable starter library includes Inter, Source Sans 3, Manrope, DM Sans, Source Serif 4, Lora, Noto Sans, Noto Sans Devanagari and Noto Sans Gurmukhi, plus the system font. These are nine curated Google font families, not the entire Google Fonts catalog. Heading and body choices are independent.

WOFF2 files are served locally with `font-display: swap` and Unicode ranges; visitors do not request them from Google. The pack includes original OFL licenses and source/hash manifests. Verify it with:

```sh
node scripts/sync-website-fonts.mjs --verify
```

The synchronization script uses official sources during an intentional development-time refresh. Runtime and production builds do not require a Fonts API key or Google font downloads. Contrast guidance checks normal text and white button labels against the chosen colors; it is not a complete accessibility audit.

## Canonical local details

NAP means name, address and phone. Each real location has one public record, distinct from legal invoice identity. A formatted display phone must contain the same digits as its canonical international phone. Exactly one location is primary when locations exist.

Publishing generates each location's page at its configured path, adds it to the sitemap, and renders matching MedicalClinic JSON-LD with address, telephone, hours, special dates, coordinates and map/profile references. Contact pages and homepage location sections reuse these records; the primary record supplies header/footer NAP. Reserved routes and collisions with CMS page routes are rejected.

Location booking links preselect the correct branch. The API validates the branch against the published location records, checks selected clinicians and services for that branch, and stores the branch on the inquiry. Time suggestions are filtered by branch and shown in the selected location's timezone.

The NAP reference CSV supports manual reviews of Google Business Profile and other directories. Recording a profile link does not verify ownership or external consistency. Check each actual branch and distinguish appointment, fax, after-hours and registered-office contacts. Avoid duplicating nearly identical city pages for areas without a clinic. Testimonials do not automatically create self-serving review-rating markup.

Current hour controls support one opening interval per weekday and date exceptions; split-day, overnight and 24-hour schedules require a future extension. Changing or removing a generated location path currently removes its old route at the next publication; it does not create a redirect automatically. Review links before making that change. Normal CMS page slug redirects remain available through the page publishing workflow.

## Drafts, publication and recovery

Edits remain in the browser until **Save website draft**. Navigation between these settings pages keeps the current values. Unsaved drafts use the existing private, identity-scoped tab memory with a 30-minute lifetime, not persistent browser storage. A recovered draft based on an older version cannot silently replace newer server settings. Reloading the saved draft discards the local edits explicitly.

Saving does not update the public website, including before its first theme publication. Review **Preview & publish**, save, then activate a validated theme. Theme activation captures content, website settings, design and business identity in an immutable publication. Rollback restores the prior snapshot. Old ZIP theme layouts remain supported until an editable homepage is configured. Use the homepage and branding reset controls to return to the active theme’s layout and design defaults.

The deployed public origin remains authoritative for canonical URLs; operators configure `PUBLIC_URL` and the reverse proxy. The editor's canonical-origin field records the intended HTTPS origin and should match that deployment. Page SEO/schema overrides are available in the existing Pages editor; generated location pages inherit defaults and their canonical branch facts.

The preview uses the same public components as the published pages and disables navigation. Public content remains server-rendered; the interactive editor is limited to authenticated workspace routes.
