<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS example themes

Read the [theme development guide](../../docs/THEME-DEVELOPMENT.md) before changing the manifest. Both examples use format version 1 and the repository's MIT license. They contain fictional, neutral copy and no patient information or third-party photography.

- `minimal/` is a complete, asset-free theme with three homepage sections.
- `community/` has six sections and an original geometric PNG illustration. The image is released under the repository's MIT license; it does not depict a real clinic or person.

With dependencies installed and ClamAV running, package from the repository root:

```sh
pnpm theme:package pack examples/themes/minimal .runtime/theme-builds/clinicscms-minimal-1.0.0.zip
pnpm theme:package pack examples/themes/community .runtime/theme-builds/clinicscms-community-1.0.0.zip
pnpm theme:package check .runtime/theme-builds/clinicscms-community-1.0.0.zip
```

The packager scans and validates using the application's actual rules, refuses symlinks and existing output files, and never uploads or activates a theme. Set `CLAMD_CONFIG` for a non-default daemon configuration. The resulting ZIP has `theme.json` at its root, without an enclosing `community/` folder.

Only `theme.json` and supported assets belong inside each source directory. Keep README, license documents, design source files and build tools outside it. The source repository's MIT license is distributed with this collection; the ZIP's `license` field identifies that license. For independently distributed themes, deliver the full applicable license and attribution notices alongside the ZIP.

Upload through **Website themes → Upload ZIP**, review the sample theme preview, and review saved clinic content through **Website settings → Preview & publish**. If homepage or branding settings override the ZIP, use the explicit reset controls to return to theme defaults, save the draft, and publish. ZIP themes do not carry website settings, doctors, services, locations, pages, API credentials or clinical records.
