# AionUi v2.1.41 Source Scope

The upstream commit contains 2,033 tracked files. Actestra retains the exact
1,766-file runnable desktop foundation needed to preserve the original desktop
functional UI, build, tests, and compatibility surfaces.

## Complete tracked subtrees

No tracked file is omitted from these upstream subtrees:

- `packages/`;
- `public/`;
- `patches/`;
- `tests/`;
- `examples/`.

The selection also includes the root package metadata, lockfile, TypeScript,
Vitest, Playwright, UnoCSS, formatting, lint, entitlement, and license files,
plus functionally required desktop icons, localization, and Windows resources.

## Excluded tracked categories

| Category | Files | Reason |
| --- | ---: | --- |
| Separate mobile application | 81 | The user-selected foundation is AionUi Desktop; mobile is a different product surface and build |
| Promotional and README-reference resources | 60 | Marketing screenshots, videos, banners, and demonstrations are not runtime functional UI |
| Upstream repository docs, governance, and CI | 114 | Upstream contribution instructions, PR templates, triage automation, release workflows, and product documents do not execute in the desktop app |
| Non-desktop root tooling | 12 | Docker, Homebrew example, Make/Just, Codecov, and similar upstream repository operations are not desktop runtime source |
| **Total excluded** | **267** | 2,033 upstream tracked files minus 1,766 retained files |

The exclusions do not authorize removal of any AionUi Desktop function or
functional UI. If a retained route, bridge domain, test, build, or downstream
patch later requires one of these files, import that exact pinned file, update
the manifest and scope counts, and record the reason.

## Functional-closure evidence

- all upstream tracked files under `packages`, `public`, `patches`, `tests`, and
  `examples` are present;
- the exact locked dependency installation passes;
- the native production desktop build passes;
- the full native Vitest suite passes 321 files with 1 skipped and 2,576 tests
  with 5 skipped;
- the native Electron application launches from the retained source in an
  isolated profile;
- the preservation checker requires every retained hash, 27 desktop routes,
  and 41 functional bridge domains.

This is a runnable desktop source scope, not a claim that the separate mobile
application, upstream CI/release system, or promotional repository media are
part of Actestra.
