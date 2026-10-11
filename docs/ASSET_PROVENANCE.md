# Asset provenance

This file records the origin and redistribution status of non-code assets shipped with Dashcenter. Update it whenever a distributed asset is added or replaced.

## `public/assets/dashcenter-mark.svg`

- Status: project-specific vector mark
- Contributor: diabloduvi-ops
- Introduced: 2026-08-21
- External source or reference asset: none recorded in the file or introducing commit
- Format: original SVG geometry with no embedded fonts or linked assets
- SHA-256: `23e5aa74d8ce4396d72fbc144f436f8512a22ca4b1366a466457fc1418de4b94`
- Project licence: `AGPL-3.0-only`, to the extent copyright and related rights apply

The mark is used directly as the favicon and web-app icon. Raster app-icon paths are not declared unless matching files are shipped.

## `public/assets/icon-catalog.json`

- Status: generated filename inventory from a third-party icon collection
- Upstream: [homarr-labs/dashboard-icons](https://github.com/homarr-labs/dashboard-icons)
- Upstream revision: `8a8c513b7d0b544ee56e366a9d5be364439d2226`
- Generated in Dashcenter: 2026-08-21
- Content: sorted icon filenames plus source, revision and licence metadata; no icon image bytes
- SHA-256: `fa8aa311b4bd1e4404f31d2bf8040756ec011a8e943c5f66698179b3f1c81cf1`
- Upstream licence: Apache-2.0; see `third_party_licenses/homarr-labs-dashboard-icons-LICENSE`

## `public/assets/dashcenter-forest.png`

- Status: generated specifically for the Dashcenter project; uniqueness or originality is not guaranteed
- Contributor: diabloduvi-ops, using OpenAI image generation at the contributor's direction
- Created: 2026-08-21
- Method: OpenAI built-in image generation from a text-only prompt
- Reference images: none
- Post-processing: none; the generated PNG and its embedded provenance metadata are retained
- Dimensions: 1672 × 941 pixels
- SHA-256: `542fbe4b5c5294a49dcce46e766df3b7410aca75047e409f7ac8b0442aeb6b92`
- Project licence: `AGPL-3.0-only`, to the extent copyright and related rights apply

Prompt:

> Use case: photorealistic-natural  
> Asset type: wide desktop dashboard background  
> Primary request: an original, cinematic misty forest scene that feels calm, modern and unobtrusive behind a dark translucent self-hosted dashboard  
> Scene/backdrop: dense Central European evergreen and beech forest at early dawn, light fog between tall trunks, subtle depth, no recognizable landmark  
> Style/medium: realistic fine-art nature photography, natural detail, premium but restrained  
> Composition/framing: wide landscape composition; open atmospheric depth through the center; darker foliage around the outer edges; avoid a single dominant subject so dashboard cards remain readable  
> Lighting/mood: low-key diffuse dawn light, quiet and slightly mysterious, gentle fog, no harsh highlights  
> Color palette: deep charcoal, forest green, muted teal, with a very subtle plum-brown shadow tint  
> Constraints: entirely original composition; suitable for a 16:9 or ultrawide screen crop; no text, no logo, no watermark, no people, no animals, no buildings, no roads, no UI elements  
> Avoid: oversaturated colors, fantasy glow, dramatic sun rays, high contrast hotspots, copied or recognizable stock-photo composition

## `docs/design/renders/redesign-v1/*.png`

- Status: generated design references; not runtime application assets
- Contributor: diabloduvi-ops, using OpenAI image generation at the contributor's direction
- Created: 2026-09-23
- Method: OpenAI built-in image generation from detailed Dashcenter interface prompts
- Reference images: the contributor's running Dashcenter screenshots and two contributor-supplied dashboard inspiration images
- Use: implementation guidance for hierarchy, composition, responsive behavior and visual density
- External code or UI assets copied into the project: none
- Project licence: `AGPL-3.0-only`, to the extent copyright and related rights apply

Files:

- `appearance-editor.png` — 1586 × 992 — SHA-256 `59ef27aa755ee56fdd50bc24bc508416f9caf168f28dbf899f880592b0133def`
- `dashboard-desktop.png` — 1586 × 992 — SHA-256 `15fa0f8acbed9e939d11577382f601bcdfe0cbdb5f6002da4ecf467350d15fea`
- `dashboard-editor.png` — 1586 × 992 — SHA-256 `c12f7b59549e48a68200cd574edc2709ab1938a32a5e19baac5c29d79cb13c2f`
- `dashboard-mobile.png` — 754 × 2086 — SHA-256 `ebc3061eb88c26f12ebf4fc4a403dbbdafbfcbf22d9a9b0a1fb6f2fe1ee8ad89`
- `dashboard-tablet.png` — 1086 × 1448 — SHA-256 `239da63f73a6228e0533f3e6c5f874085d765b855815ee21654a84ca551b0490`
- `services-editor.png` — 1586 × 992 — SHA-256 `d6d20cd9b65768e4b690497e1756318ecb1c4c1d307a47df26f6b5b60f2bd151`

The renders are directional. Existing Dashcenter data, brand assets, accessibility rules, security constraints and saved layout semantics remain authoritative during implementation.
