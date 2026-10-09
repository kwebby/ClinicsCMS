<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Self-hosted website font catalog

Nine Google Fonts families are bundled as unmodified official WOFF2 files. Each family includes its original SIL Open Font License 1.1 notice. SOURCES.json records the pinned Google Fonts license repository revision, source URLs, download date, byte sizes and SHA-256 checksums. The generated stylesheet contains only same-origin /fonts/ URLs with font-display: swap; fonts are requested only when selected and required by the text's Unicode ranges.

Included subsets: Latin and Latin Extended for every family, plus Devanagari and Gurmukhi in their respective Noto families. These files cover normal variable weights 400–700; italic uses the browser's synthesized style. Other writing systems use the configured system fallback.

Verify locally: node scripts/sync-website-fonts.mjs --verify

An explicit maintenance refresh uses node scripts/sync-website-fonts.mjs. Review source/version/hash changes before release. Production builds do not run that command and do not need network access to Google. Original third-party licenses remain unchanged; the project watermark applies to the packaging script and stylesheet, not to font authorship.
