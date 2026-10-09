<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Third-party notices

The root MIT license covers first-party ClinicsCMS code and documentation. Dependencies, bundled fonts and third-party material retain their original copyrights and licenses.

## Fonts

The curated font files in `apps/web/public/fonts` are distributed with their individual SIL Open Font License texts, original source URLs and SHA-256 checksums. See [font provenance](apps/web/public/fonts/README.md) and [source manifest](apps/web/public/fonts/SOURCES.json). Preserve those license notices when redistributing the assets.

## JavaScript packages and containers

Exact packages are pinned by `package.json`, `apps/web/package.json` and `pnpm-lock.yaml`. Each installed package carries its own license. CI runs a dependency license inventory; reproduce the inventory using `pnpm exec license-checker-rseidelsohn --production --json`. BlockNote core packages are used; separately licensed XL functionality is not bundled. Container images and their operating-system packages have separate notices and licenses.

## Research and examples

The clinic research report links public source websites and records observations. Those sites' names, trademarks, images and source content remain owned by their respective owners. No clinic affiliation or endorsement is implied. The report is evidence for design decisions, not a license to reuse third-party site assets.

The starter theme illustration in `examples/themes/community/assets` was created for this project and is included under the repository MIT license. Theme authors are responsible for their own asset rights and required accompanying notices.
