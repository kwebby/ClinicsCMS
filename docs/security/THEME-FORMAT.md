<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS declarative theme package format v1

For starter projects, packaging commands, customization boundaries, and a complete walkthrough, see [theme development](../THEME-DEVELOPMENT.md). This reference describes the validator contract; accepted layout keys and block variants do not imply that every renderer consumes every field.

A ZIP contains one root `theme.json` and optional `assets/` PNG, JPEG, WebP or WOFF2 files. Themes are data, rendered by application-owned components. Scripts, arbitrary HTML/CSS, URLs to external resources, nested/encrypted archives, path traversal, symlinks, duplicate entries and unsupported files are rejected. Limits: 25 MiB ZIP, 100 MiB expanded, 1,000 entries, 20 MiB per entry, 100:1 maximum expansion ratio. Images are signature-checked, decoded and limited to 40 megapixels. A working malware scanner is mandatory.

Minimal example (all supported page-layout keys are explicit):

```json
{
  "formatVersion": 1,
  "name": "My clinic",
  "slug": "my-clinic",
  "version": "1.0.0",
  "description": "An accessible clinic website",
  "author": "Clinic team",
  "license": "MIT",
  "tokens": {
    "primary": "#18756B",
    "secondary": "#D1E9E3",
    "background": "#FAFBF8",
    "text": "#172B29",
    "muted": "#586E69",
    "radius": 16,
    "fontFamily": "sans",
    "baseFontSize": 16,
    "maxWidth": 1200
  },
  "layouts": {
    "home": [{"id": "welcome", "type": "hero", "variant": "split", "heading": "Welcome to our clinic"}],
    "page": [{"id": "body", "type": "article", "variant": "default"}],
    "article": [], "service": [], "doctor": [], "contact": [], "tool": []
  },
  "navigation": [{"label": "Our care", "href": "/services"}]
}
```

Allowed block types: `hero`, `services`, `doctors`, `article`, `faq`, `contact`, `tool`, `testimonials`, `cta`, `footer`. Variants: `default`, `split`, `centered`, `compact`. Blocks accept bounded `heading`, `text`, and `image` references under `assets/`; all references must exist. An optional root `preview` points to a package image. Tokens accept six-digit hex colors, radius 0–32, system/sans/serif fonts, base font size 14–22, and layout width 960–1600. Navigation uses same-site paths. Renderer components decide which variant properties they support; unsupported executable behavior cannot enter through a theme.

Uploading creates an immutable validated version. Preview/export are authorized staff operations. Activation checks an optional expected publication ID and atomically records the chosen theme, public settings, and approved page snapshots. Rollback restores the prior binding exactly. Editing a page does not overwrite a bound public snapshot; publish the website again to make the new page revision live. Theme ZIP export reproduces the declarative theme/assets, without clinic records or credentials.
