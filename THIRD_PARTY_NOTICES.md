# Third-party notices

Dashcenter uses open-source packages and can display icons, product names and logos supplied by third parties. Those materials remain governed by their own licences and trademark rules. This notice is informational and does not replace the upstream licence texts.

## Homepage inspiration and non-affiliation

Dashcenter is an independent implementation inspired by the dashboard concepts and usability of [Homepage](https://github.com/gethomepage/homepage). Homepage is licensed under [GNU GPL v3.0](https://github.com/gethomepage/homepage/blob/main/LICENSE).

Dashcenter is not affiliated with, endorsed by, or maintained by Homepage or its maintainers. No claim of compatibility, sponsorship or ownership of the Homepage name is made. The completed technical provenance review and its limits are recorded in [docs/SOURCE_PROVENANCE.md](docs/SOURCE_PROVENANCE.md).

## Remote icon sources

Dashcenter resolves icon names through a server-side proxy restricted to pinned upstream sources. Icon files are fetched on demand and are not vendored into this repository unless explicitly stated.

- [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons), revision `8a8c513b7d0b544ee56e366a9d5be364439d2226` — Apache-2.0. Dashcenter vendors a searchable filename catalog and fetches selected icons through jsDelivr. A verbatim copy of the upstream licence and copyright notice is included at [third_party_licenses/homarr-labs-dashboard-icons-LICENSE](third_party_licenses/homarr-labs-dashboard-icons-LICENSE).
- [selfhst/icons](https://github.com/selfhst/icons), revision `948e3aa28d3110ee23957473a85431650e10e778` — CC-BY-4.0. Used for Homepage-compatible `sh-*` icon references through jsDelivr; icons are not modified by Dashcenter. The upstream licence is included at [third_party_licenses/selfhst-icons-LICENSE](third_party_licenses/selfhst-icons-LICENSE).
- [Material Design Icons SVG](https://github.com/Templarian/MaterialDesign-SVG/tree/v7.4.47) `7.4.47` — Pictogrammers Free License; the icons and fonts are distributed under Apache-2.0, with non-icon code under MIT. Used for `mdi-*` references through jsDelivr with a pinned unpkg fallback. The upstream notice is included at [third_party_licenses/material-design-icons-LICENSE](third_party_licenses/material-design-icons-LICENSE).
- [Simple Icons](https://github.com/simple-icons/simple-icons/tree/16.28.0) `16.28.0` — CC0-1.0 for the collection. Individual brand marks can remain subject to separate trademark, copyright or brand rules. The upstream [licence](third_party_licenses/simple-icons-LICENSE.md) and [brand disclaimer](third_party_licenses/simple-icons-DISCLAIMER.md) are included.

Service and product names, logos and marks belong to their respective owners. Their display identifies a user-configured link or integration and does not imply endorsement of Dashcenter.

## Steam integration

The optional Steam wishlist plugin retrieves public wishlist and store information from Steam-operated endpoints. Game artwork remains hosted by Steam and is not bundled with Dashcenter. Steam, the Steam logo and individual game names and artwork are trademarks or copyrighted materials of Valve Corporation and their respective owners. Their display identifies user-selected public store content and does not imply Valve endorsement or affiliation.

## JavaScript runtime dependencies

The exact resolved dependency graph is recorded in `pnpm-lock.yaml`. A generated inventory of all production packages, resolved versions, declared licences and project links is included at [docs/DEPENDENCY_LICENSES.md](docs/DEPENDENCY_LICENSES.md). Package licence files remain in the installed package directories included in the runtime image. CI rejects a stale inventory.

## Companion container

The optional Compose stack uses [Tecnativa Docker Socket Proxy](https://github.com/Tecnativa/docker-socket-proxy/tree/v0.4.2) `v0.4.2`, pinned by image digest and distributed under Apache-2.0. Dashcenter supplies a stricter HAProxy configuration that permits only the four Docker metadata routes the application calls. The upstream licence is included at [third_party_licenses/docker-socket-proxy-LICENSE.txt](third_party_licenses/docker-socket-proxy-LICENSE.txt).

## Generated project background

`public/assets/dashcenter-forest.png` was generated specifically for Dashcenter from a text-only prompt on 2026-08-21, without a reference image. AI-assisted output is not guaranteed to be unique or original. Its detailed provenance and SHA-256 checksum are recorded in [docs/ASSET_PROVENANCE.md](docs/ASSET_PROVENANCE.md). It is made available under `AGPL-3.0-only` with the project-specific assets, to the extent copyright and related rights apply.

The Dashcenter vector mark is a project-specific asset introduced by the project maintainer. Its repository history and checksum are recorded in the same provenance document.

## Test image fixtures

Automated upload-validation tests include small upstream image fixtures so the structural validators are exercised with independently generated, decodable files. These fixtures are test-only and retain their upstream terms.

- `server/fixtures/images/libjpeg-turbo-testorig.jpg` from [libjpeg-turbo](https://github.com/libjpeg-turbo/libjpeg-turbo), Git blob `9816a0c6231a7c5eaafd445368a9eeb1cffc63df` — IJG License. The upstream terms are included at [third_party_licenses/libjpeg-turbo-README.ijg](third_party_licenses/libjpeg-turbo-README.ijg).
- `server/fixtures/images/libwebp-test.webp` from [libwebp](https://github.com/webmproject/libwebp), Git blob `3e4bca1d8500ec465177ebac7c30d6cfde656c10` — BSD-3-Clause-style licence. The upstream text is included at [third_party_licenses/libwebp-COPYING](third_party_licenses/libwebp-COPYING).
