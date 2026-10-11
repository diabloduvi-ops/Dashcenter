# Changelog

All notable Dashcenter changes are recorded here. The project follows [Semantic Versioning](https://semver.org/): features are released when ready instead of waiting for a large roadmap bundle.

## [Unreleased]

## [1.0.2] - 2026-10-10

### Security

- Limited anonymous dashboard responses to published groups, services and widgets. Internal Docker endpoints, plugin configuration and hidden content remain available only to authenticated administrators.
- Restricted administrative read routes and prevented direct plugin requests from exposing services inside hidden groups.
- Added short login cooldowns after repeated failed attempts from one client or against one account.
- Disabled the development authentication bypass when the server runs in production mode.

### Changed

- Prepared the public installation guidance and kept existing saved dashboards, credentials and backups compatible without a data migration.

## [1.0.1] - 2026-10-10

### Changed

- Made Settings the single entry point from the published dashboard to the editor, and renamed its exit action to Close editor, including an accessible mobile exit control.

### Removed

- Removed the duplicate Edit layout menu and the incomplete light-mode toggle. Appearance presets remain available in Settings.

## [1.0.0] - 2026-10-09

### Changed

- Finished the shared Forest administration language for Widgets and Backups: matching workspace headers, calmer surfaces, a focused backup/history flow, and responsive navigation.
- Replaced browser-native delete and restore prompts in the active Services and Backups workspaces with the accessible shared confirmation dialog.
- Removed the misleading autosave and Done toolbar from Widgets and Backups. Configuration actions remain explicit where required.
- Corrected the mobile layout editor so its inspector follows the canvas instead of covering it, and clarified that saved layouts are stored on the server.
- Preserved existing dashboard data, backup and revision formats, service plugins, widget settings, and credentials without a migration.

### Security

- Updated `@fastify/busboy` to 3.2.2, `source-map-js` to 1.2.2, and the development-only `shell-quote` dependency to 1.11.0 to address the reported dependency advisories.

## [0.38.0] - 2026-10-06

### Security

- Updated the runtime `brace-expansion` dependency to 5.0.12 to address three newly reported denial-of-service advisories.

### Changed

- Restored a light, translucent shell around service categories while keeping the Forest background visible and using the same neutral frames as dashboard widgets.
- Kept native plugin cards at their full content height inside categories, including Steam wishlist artwork, discounts, prices and ratings.
- Made the Dashboard editor canvas preserve readable desktop columns and show the configured header over the dashboard background; card selection now has a direct keyboard-accessible control.
- Replaced the sample Appearance illustration with a read-only preview of the current groups, services, widgets and layout, including desktop, tablet and mobile modes.
- Adjusted the Forest preset to the approved lighter overlay, panel opacity and blur; existing saved custom appearance values remain untouched.

## [0.37.0] - 2026-10-04

### Changed

- Removed the full service-category background so each service card sits directly on the dashboard canvas; kept individual cards readable over the Forest image.
- Gave category headings the same configurable glass surface as dashboard widgets, keeping the service grid transparent.
- Unified category icon frames so Docker no longer receives a green background from its health state. Health remains visible in the text and status indicator.
- Rebuilt Users as a focused account and current-session workspace with a responsive navigation flow and explicit password action.
- Removed the misleading generic autosave toolbar from Users, where password changes require an explicit action.

### Compatibility

- Preserved existing accounts, sessions, authentication APIs, password behavior, service layouts, plugins, widgets and appearance settings without a data migration.

## [0.36.0] - 2026-10-02

### Added

- Added the bounded Connections workspace with a Docker host list, focused connection inspector, explicit saved, disabled, testing, success, failure and discovery states, and persistent actions.
- Added a shared accessible confirmation dialog with keyboard dismissal, focus containment and focus restoration for connection deletion and Homepage imports.

### Changed

- Renamed the permanent administration destination from **Integrations** to **Connections** so reusable infrastructure is separate from service-owned native plugins.
- Rebuilt Homepage import as a source → preview → confirmed import flow inside Connections, with a clear summary of what will be replaced and what remains unchanged.
- Limited container discovery to saved connections and kept connection tests read-only.

### Responsive

- Added a bounded desktop list/detail workspace, tablet master/detail layout and mobile Docker hosts → connection detail drill-down.
- Stacked Homepage source and preview panes on narrow screens while preserving independent scrolling and persistent import actions.

### Compatibility

- Preserved Docker connection APIs, Homepage YAML parsing and export, server-side data storage, existing saved connections, dashboard content and backup formats without a migration.

## [0.35.0] - 2026-10-01

### Added

- Added the approved Appearance workspace with a large deterministic dashboard preview and a dedicated visual-token inspector.
- Added truthful desktop, tablet and mobile preview modes that use fixed target dimensions and shared dashboard appearance tokens.
- Added focused Theme, Typography, Surfaces, Icons and Motion sections with instant draft feedback, preset reset and explicit Save appearance actions.

### Changed

- Reorganized the existing versioned appearance model into a bounded two-pane editor without mixing navigation, language, layout or service configuration into visual settings.
- Kept the dashboard background readable through the existing overlay and blur controls instead of applying an extra dark presentation layer.
- Changed background image upload to prepare a draft URL; the published dashboard changes only after Save appearance succeeds.

### Compatibility

- Preserved all existing Forest, Graphite, Nord and Warm settings, custom semantic tokens, uploaded backgrounds, revisions and JSON backup round-trips without a data migration.
- Kept the published dashboard, layout, widgets, services and server-side credentials on their existing storage contracts.

## [0.34.0] - 2026-09-28

### Added

- Added the approved three-pane Services workspace with searchable service groups, a selected-group service list and a wide service inspector.
- Added General, Status, Plugin and Layout inspector tabs, explicit service status text, service-to-group movement and persistent Delete, Discard and Save actions.
- Added a real dashboard-card preview for every existing native provider while keeping new or changed providers inactive in preview until their configuration is saved.
- Added the responsive master/detail layout for tablets and a Groups → Services → Inspector drill-down flow with persistent back navigation on mobile.

### Changed

- Moved group editing into a focused panel owned by the group list, leaving provider credentials and service settings in the wide inspector.
- Kept all existing provider-specific controls, connection tests, data selectors and summary or expanded presentation options while giving them the full inspector width.

### Compatibility

- Preserved existing groups, services, status sources, plugin configurations, dashboard layout, revisions and backups without a data migration.
- Kept provider credentials server-side and continued to use the existing authenticated credential and connection-test endpoints.

## [0.33.1] - 2026-09-28

### Fixed

- Kept the desktop editor preview readable in narrow windows by deriving its minimum canvas width from the configured board columns instead of compressing modules below a useful width.
- Preserved truthful `768px` tablet and `390px` mobile preview canvases when the editor pane is narrower, with horizontal scrolling isolated to the central canvas.

## [0.33.0] - 2026-09-28

### Added

- Added the approved dedicated Dashboard layout workspace with a stable left navigation, real-content canvas, and right Add/Selected inspector.
- Added desktop, tablet, and mobile canvas previews while keeping placement changes in the desktop workspace.

### Changed

- Made **Settings** the primary published-dashboard action and moved **Edit layout** into the secondary actions menu.
- Kept real service groups, widgets, plugin presentations, drag-and-drop swaps, pointer resize, undo/redo, and keyboard placement controls inside the dedicated editor.

### Fixed

- Removed the sticky inline editor that covered dashboard content while scrolling and allowed inspector controls to escape the available width.
- Kept the editor canvas and inspector in separate bounded regions so controls and dashboard modules no longer overlap.

## [0.32.1] - 2026-09-28

### Fixed

- Restored compact elongated service rows while retaining the saved horizontal multi-column or vertical single-column group flow.
- Preserved each native plugin's saved summary or expanded presentation instead of forcing horizontal groups into compact summaries.
- Let saved row heights act as minimum sizes so dynamic plugin and widget content expands the measured board instead of being clipped.
- Reworked Steam wishlist deals into a wrapping responsive grid that keeps complete cards visible without an internal horizontal crop.
- Unified dashboard module borders around the neutral surface border while keeping health colors in explicit status indicators.

### Responsive

- Kept plugin service rows consistent with ordinary service rows on mobile and preserved the single-column dashboard without page overflow.

## [0.32.0] - 2026-09-27

### Added

- Added a direct layout mode around the real published dashboard, entered from **Edit dashboard** or the administration overview.
- Added stable swap-after-drop movement, visible move and resize handles, exact width, height and start-column controls, plus Save, Cancel, Undo and Redo.
- Added per-group horizontal tile and vertical list presentation with migration-safe defaults for existing databases, revisions and JSON backups.

### Changed

- Replaced estimated group heights and full-row placement with one measured board that uses each rendered module's actual content height, preventing overlap while filling space below shorter cards.
- Kept dashboard groups and dashboard widgets in one saved board while topbar widgets remain a separate compact module family.
- Replaced the miniature administration layout cards as the primary editor with a link to the direct dashboard editor.
- Refined tablet and mobile behavior so the board resolves to two columns at tablet width and one compact service row per line on narrow screens.

### Accessibility

- Added accessible names and focus states to editor actions, move handles and resize handles.
- Preserved keyboard sorting and added explicit inspector controls as alternatives to pointer movement and resizing.
- Prevented horizontal page overflow in the mobile dashboard and editor while keeping the inspector independently scrollable.

### Compatibility

- Existing groups default to horizontal presentation and retain their saved order, spans, fixed or automatic heights, services, plugins and credentials.
- Layout saves continue through the existing authenticated, revisioned dashboard transaction; automatic refresh pauses only while a local edit draft is active.

## [0.31.0] - 2026-09-27

### Changed

- Rebuilt the published desktop dashboard around the approved compact glass-module composition while preserving the saved board order, widths, fixed heights and automatic sizing.
- Consolidated the header into one responsive topbar with bordered search, host resources, service availability, time and action modules in the saved widget order.
- Converted service groups from long lists into responsive launch tiles with shared headers, service counts and explicit text status alongside the existing color indicators.
- Reworked **Server health** into real CPU and memory trend panels with disk, uptime and optional Docker container facts.
- Unified the visual anatomy and density of calendar, feed, media activity, service health and network traffic cards.

### Accessibility

- Added visible status text to service tiles so health is never communicated by color alone.
- Preserved named controls, keyboard focus, reduced motion, searchable services and the accessible service-availability detail panel.

### Compatibility

- Preserved existing services, plugins, credentials, widgets, revisions, backups and the `1–6` column / `1–3` span layout model without a database migration.
- Kept all provider credentials server-side and continued to render honest loading, setup, unavailable and empty states when live data is missing.

## [0.30.0] - 2026-09-26

### Added

- Added versioned **Forest**, **Graphite**, **Nord** and **Warm** appearance presets with a live preview.
- Added shared semantic controls for dashboard colors, panel opacity and blur, overlay strength, borders, radius, shadow, density, typography, number style, motion and icon treatment.
- Added accessible color pickers with explicit color-picker and hexadecimal-value labels.

### Changed

- Applied appearance values through the shared dashboard token contract, including compatibility aliases used by existing cards and service groups.
- Kept functional board placement in **Dashboard** while **Appearance** remains responsible for visual styling.

### Compatibility

- Migrated existing visual settings to appearance model v1 once while preserving each dashboard's accent, opacity, blur and density.
- Preserved named and custom themes through revisions and JSON backup restore; older backups receive safe semantic defaults.
- Kept the approved brighter Forest background treatment so readability continues to come from the configurable overlay and blur.

## [0.29.0] - 2026-09-26

### Added

- Added a resizable **Network traffic** dashboard card backed by one configured MikroTik service and interface.
- Added live WAN download and upload rates, bounded in-memory history for up to 120 samples, interface state and active DHCP device totals.
- Added MikroTik interface discovery to the service connection test and an explicit traffic-interface selector in the service editor.
- Added setup, loading, warming-up, interface-down and unavailable states without displaying invented values.

### Security

- Kept RouterOS credentials in the existing server-side service credential store; widget configuration contains only the selected service identifier and label.
- Kept the integration read-only with bounded GET responses, an eight-second timeout, cached sampling and deduplicated in-flight requests.
- Exposed only the selected interface summary and calculated rates in the public dashboard payload; the interface inventory remains limited to the authenticated connection test.

### Compatibility

- Preserved existing MikroTik services, widgets, layouts, revisions, backups and credentials without a database migration.
- Kept rate history process-local so restarts begin with an honest warming-up state and no new persistent data is added to backups.

## [0.28.0] - 2026-09-24

### Added

- Added a resizable **Now playing** dashboard card that can combine one or more configured Jellyfin and Plex services.
- Added bounded session details for title, series and episode context, playback state, progress, client, device, user, quality and play method.
- Added optional Jellyfin and Plex artwork through a server-side proxy with opaque references and a visual fallback when artwork is missing or unavailable.
- Added setup, loading, empty, partial-failure and unavailable states; one failing provider no longer hides healthy media sources in the same widget.

### Security

- Kept media credentials on their existing service plugins; widget configuration stores only service identifiers and visual options.
- Restricted artwork to provider-registered same-origin paths, disabled redirects, enforced an eight-second timeout and four-megabyte limit, and accepted only verified JPEG, PNG, GIF or WebP bytes.
- Kept Jellyfin 12 authentication on the shared `MediaBrowser Token` header and Plex authentication on `X-Plex-Token`; neither secret is placed in an artwork URL or public payload.

### Compatibility

- Preserved existing service plugins, widgets, layouts, revisions, backups and stored credentials without a database migration.
- New media cards join the existing shared board at two columns by two rows and remain configurable from one through three columns and rows.

## [0.27.0] - 2026-09-24

### Added

- Added one-, five- and fifteen-minute host load averages to the public system-resource response.
- Added an in-memory CPU and memory trend with five-minute samples and a bounded 24-hour retention window that restarts with Dashcenter.
- Added optional Docker container totals and running, stopped, healthy and unhealthy counts to the Server health card when a configured connection is selected.
- Added a resizable Service health dashboard card that reuses the existing service availability summary and highlights services that need attention.

### Changed

- Extended the existing Server health card with real load and trend data while keeping the compact topbar resource widget unchanged.
- Isolated Docker metadata failures so host resource metrics continue to work when the selected Docker connection is unavailable.
- Added server-health Docker source selection and clear history-retention guidance to the widget editor.

### Compatibility

- Preserved existing widget, layout, backup and credential data without a migration.
- Kept Docker counts optional and aggregate-only; no container names, credentials or provider configuration are exposed by the system-resource endpoint.

## [0.26.1] - 2026-09-23

### Fixed

- Reduced the default Forest background overlay so the image remains clearly visible while existing panel opacity and blur controls continue to manage readability.
- Preserved existing appearance settings, saved dashboards, revisions and JSON backup compatibility without adding a migration.

### Security

- Updated vulnerable production dependencies and added targeted package resolutions, clearing all 19 open Dependabot alerts present before this release.
- Regenerated and verified the production dependency licence inventory after the security updates.

## [0.26.0] - 2026-09-23

### Added

- Added the accepted v1 visual contract, implementation plan and six responsive reference renders for the public dashboard and primary administration workspaces.
- Added a shared semantic token layer for Forest colors, typography, spacing, radii, dimensions, elevation, focus and motion.
- Added warning and information states to the shared administration notice and status primitives.
- Added accessible inline field errors with associated descriptions and invalid-state styling.

### Changed

- Mapped the existing dashboard and administration variables onto one compatibility-safe visual foundation.
- Increased common administration controls to the documented desktop and touch target sizes.
- Replaced decorative administration panel gradients with calm opaque surfaces and strengthened the Forest background overlay for dashboard readability.
- Standardized focus treatment, feedback timing and reduced-motion behavior across public and administration controls.

### Accessibility

- Preserved visible keyboard focus through a shared semantic focus role.
- Kept static guidance quiet while urgent errors use alerts and successful dynamic notices use status announcements.
- Expanded switch hit areas without enlarging the visible track.

## [0.25.1] - 2026-09-13

### Fixed

- Added the complete Docker Compose definition to the Portainer installation guide.
- Built the restricted Docker metadata gateway configuration into its own local image so Git-based Portainer deployments do not depend on Business-only relative-path volume support.
- Extended CI to build both production images through the checked-in Compose definition.

## [0.25.0] - 2026-09-13

### Added

- Added public bug-report and feature-request forms together with a private vulnerability-reporting policy.
- Added a generated inventory of all 97 lockfile-resolved production dependency licence entries, verified by CI.
- Added source and asset provenance records covering the independent implementation review, project mark, generated background, icon catalog and upstream test fixtures.
- Added OCI source-revision metadata to container builds and exposed the bounded revision value through the health endpoint.

### Changed

- Reworked the README around Docker Compose, Portainer, a dashboard-only container and source-development deployment paths.
- Moved future planning to GitHub Issues and removed the internal next-release document.
- Replaced missing raster PWA icon references with the SVG mark that is actually distributed.

### Security

- Replaced the broad Docker proxy container policy with an exact GET-only allowlist for ping, version, container-list and container-inspection metadata routes.
- Added the missing upstream licence texts and brand-use disclaimer for remote icon sources and the pinned Docker proxy companion image.

## [0.24.0] - 2026-09-12

### Added

- Added a multi-instance **RSS & releases** dashboard card with support for RSS 2.0 and Atom feeds.
- Added separate news/article and software-release modes, including automatic version badges for release titles.
- Added configurable labels, 4–12 item limits, age filters and optional feed artwork.
- Added a polished, responsive card with a featured first item, source metadata, summaries, loading skeleton, empty state and local error state.
- New feed cards join the shared dashboard board at two columns by two rows and can be resized to every supported grid size.

### Security

- Feed URLs are stored only in the server-side credential table and are excluded from public dashboard data, revisions and JSON backups.
- Feed HTML is converted to bounded plain text; only credential-free HTTP(S) article and image URLs reach the dashboard.
- Feed requests are read-only, cached, time-limited and cancelled when the response exceeds 2 MiB.

## [0.23.0] - 2026-09-12

### Added

- Added a resizable **Calendar agenda** card to the dashboard widget catalog with configurable label, 7–60 day range and 5–20 event limit.
- Added read-only iCalendar/ICS feeds with time-zone aware timed events, all-day events, common daily, weekly, monthly and yearly recurrence, recurrence exclusions and event links.
- Added a polished timeline card with calendar name, date and time, location, next-event emphasis, loading skeleton, empty state and local error state.
- Added support for multiple independently configured calendar cards in the shared dashboard board; new cards start at two columns by two rows and remain usable at every supported size.

### Security

- Calendar feed URLs are stored only in the server-side credential table and are excluded from public dashboard data, revisions and JSON backups.
- Feed requests are read-only, time-limited, cached and cancelled when the response exceeds 2 MiB; errors never include the feed body or secret URL.

## [0.22.0] - 2026-09-12

### Added

- Added a zero-configuration **Service availability** widget to the top-bar catalog.
- Added live online, down, checking and unknown counts derived from existing service status checks.
- Added a click-open detail panel that puts unavailable services first and shows their group and latest status message.
- Added a compact mobile state with a status-colored count badge, keyboard dismissal, outside-click dismissal and clear empty/all-online states.

### Security

- The widget reuses the existing public dashboard status data and introduces no credentials, provider requests or new external connections.

## [0.21.1] - 2026-09-12

### Fixed

- Replaced unstable live grid reordering with precise card-to-card swapping.
- Only the dragged card now moves while the rest of the board stays fixed until drop.
- Added pointer-based targeting, a visible drop highlight and deterministic **Earlier**/**Later** controls for accessible ordering.

## [0.21.0] - 2026-09-11

### Added

- Added a shared dashboard board where service groups and dashboard widgets can be arranged together.
- Added per-item 1–3 column widths, automatic or 1–3 row heights, optional start columns and drag-and-drop or keyboard ordering.
- Added a zero-configuration **Server health** dashboard card with CPU, memory, disk, uptime, logical-core and last-update data.

### Changed

- Moved functional board controls from **Appearance** to **Dashboard** so Appearance remains focused on visual styling.
- Dashboard widgets now follow the same saved responsive order as service groups instead of rendering in a detached strip.
- Tablet layouts clamp the board to two columns and mobile keeps the saved order in one readable column.

### Migration

- Existing databases, revisions and JSON backups automatically receive a compatible board layout without losing groups or dashboard widgets.
- Adding or deleting a group or dashboard widget automatically reconciles its board entry; top-bar widgets remain independent.

## [0.20.0] - 2026-09-11

### Added

- Added a zero-configuration **This server** top-bar widget with live CPU, RAM, disk and uptime metrics.
- Added 5, 10 and 30 second refresh choices together with loading, unavailable and responsive mobile states.

### Changed

- Split both the widget catalog and configured-widget list into **Top bar** and **Dashboard** sections.
- Widget reordering now stays within its visual section so top-bar modules and dashboard cards keep independent order.

### Security

- The public system-resource endpoint exposes aggregate usage values only and does not return the hostname, platform, credentials or provider data.

## [0.19.1] - 2026-09-11

### Fixed

- Fixed Lidarr connection tests and dashboard data for large music libraries that previously failed with `Lidarr returned too much data.`
- Removed the duplicate full-album download and now derives album and track totals from Lidarr's per-artist statistics, reducing the adapter from five read-only requests to four.

### Security

- Lidarr responses are now read incrementally and cancelled as soon as they cross their limit; general responses remain capped at 2 MiB and the single library summary is capped at 8 MiB.
- The API key remains server-only and provider response bodies are never included in errors.

## [0.19.0] - 2026-09-10

### Added

- Added a native Lidarr service plugin with compact and expanded dashboard presentations.
- Added artist, album, monitored-library and downloaded-track coverage together with wanted-album and download-queue counts.
- Added connection testing and service-route regression coverage for Lidarr's read-only API v1 endpoints.

### Security

- Lidarr API keys stay in the server-side credential store and never enter public dashboard payloads, request URLs, logs, tests or commits.
- The adapter uses only bounded read-only requests with an eight-second timeout, a 25-second cache and concise errors that do not echo provider responses.

## [0.18.0] - 2026-09-10

### Added

- Added an explicit HTTP, Docker or Uptime Kuma source for each enabled service status indicator.
- A service with a Uptime Kuma plugin can use its selected monitor for the dashboard status dot while reusing the same server-side API key.
- Added automatic migration for existing Docker-backed services and legacy backups that predate the explicit status-source field.

### Security

- Uptime Kuma health checks remain server-side, use the existing bounded and cached read-only metrics request, and never expose API keys or monitored URLs in the dashboard payload.
- A missing monitor or credential produces an explicit unavailable status and never silently falls back to a different health check.

## [0.17.1] - 2026-09-10

### Fixed

- Header widgets now render in their saved order, so moving Search, Clock or Weather in the editor produces the same order on the published dashboard after a reload.
- Added regression coverage for reloading persisted widget positions and for the ordered header-widget rendering path.

## [0.17.0] - 2026-09-09

### Added

- Added a native Uptime Kuma service plugin configured entirely through the service editor.
- Added connection testing, monitor discovery, an all-monitor overview and optional single-monitor status, response-time and certificate metrics.
- Added compact and expanded dashboard presentations with a visible degraded state when a selected monitor or any monitor in the overview is down.

### Security

- Uptime Kuma API keys stay in the server-side credential store and never enter public dashboard payloads, URLs, logs, tests or commits.
- Metrics use only the supported read-only `/metrics` endpoint with HTTP Basic API-key authentication, a bounded response, an eight-second timeout and a 25-second cache.
- Monitor identifiers are derived from hashed metric labels so monitored URLs and hostnames do not enter saved dashboard configuration.

## [0.16.0] - 2026-09-09

### Added

- Added a native Proxmox VE service plugin configured entirely through the service editor.
- Added read-only API-token connection testing, automatic node discovery and an optional single-node scope.
- Added compact and expanded cluster metrics for node availability, running and stopped QEMU/LXC guests, CPU, memory and de-duplicated storage usage.

### Security

- Proxmox API token IDs and secrets stay in the server-side credential store and never enter public dashboard payloads, URLs, logs, tests or commits.
- Proxmox collection uses only fixed read-only `version`, `cluster/status` and `cluster/resources` endpoints, bounded responses, an eight-second timeout and a 25-second cache.
- The editor recommends a privilege-separated token with the `PVEAuditor` role and requires a TLS certificate trusted by the Dashcenter container.

## [0.15.1] - 2026-09-08

### Fixed

- Updated Jellyfin authentication for Jellyfin 12 by replacing the disabled legacy `X-Emby-Token` header with `Authorization: MediaBrowser Token="..."`.
- Applied MediaBrowser authorization centrally to system information, library count and session requests so connection testing and dashboard metrics use the same compatible client.
- Added Jellyfin 12 regression coverage that rejects legacy authentication and verifies the service plugin remains available with playback and library metrics.

### Security

- Existing Jellyfin API keys remain server-side and are never included in dashboard payloads, request URLs, logs, tests or commits.

## [0.15.0] - 2026-09-07

### Added

- Added a native Steam wishlist deals plugin configured entirely through the service editor.
- Added public-wishlist connection testing, localized store prices, minimum-discount filtering, deal sorting and configurable refresh intervals.
- Added compact summaries plus expanded, responsive deal cards with Steam artwork, current and original prices, review scores and direct store links.

### Security

- SteamID64 values stay in the server-side credential store and never enter public dashboard payloads or plugin responses.
- Steam requests are limited to fixed official API hosts, use bounded responses and timeouts, and require no Steam password, cookie or API key.
- Store artwork and outbound deal links are constructed from fixed Steam origins rather than trusting arbitrary upstream URLs.

## [0.14.0] - 2026-09-07

### Added

- Added a native Nginx Proxy Manager service plugin configured entirely through the service editor.
- Added GUI connection testing plus compact and expanded proxy-host, SSL, redirect, 404-host and stream metrics.
- Added 25-second result caching, bounded responses and clear authentication, two-factor and connectivity errors.

### Security

- Nginx Proxy Manager identities, passwords and temporary bearer tokens stay on the Dashcenter server and never enter public dashboard payloads.
- Dashboard data collection uses only read-only host-list endpoints after authentication and deliberately avoids the certificate endpoint.

## [0.13.1] - 2026-09-07

### Fixed

- Restored qBittorrent plugin login compatibility with qBittorrent 5.2 responses that use HTTP 204 and a port-scoped session cookie.
- Kept the legacy HTTP 200, `Ok.` and `SID` login flow working for older qBittorrent releases.
- Reused the saved qBittorrent username when testing an edited connection without re-entering credentials.

### Security

- Session cookies remain server-only and are forwarded to qBittorrent exactly as issued without entering dashboard payloads or logs.

## [0.13.0] - 2026-09-04

### Added

- Added a native MikroTik service plugin configured entirely through the service editor.
- Added RouterOS v7 REST API connection testing and compact or expanded dashboard presentation.
- Added uptime, CPU, memory, storage, DHCP lease, interface and router identity metrics.

### Security

- MikroTik usernames and passwords stay in the server-side credential store and are sent only through HTTP Basic authentication.
- MikroTik requests use GET only, are size-bounded, cached and protected by an eight-second timeout.
- The editor recommends a dedicated RouterOS user with read and REST API permissions plus HTTPS transport.

## [0.12.0] - 2026-09-04

### Added

- Added a native Plex service plugin configured entirely through the service editor.
- Added token authentication, connection testing and compact or expanded dashboard presentation.
- Added live stream, playing, paused, transcoding, movie, show and album metrics.

### Security

- Plex tokens stay in the server-side credential store and are sent only through the `X-Plex-Token` header.
- Plex requests are read-only, size-bounded, cached and protected by an eight-second timeout.

## [0.11.0] - 2026-09-03

### Added

- Added native Prowlarr, Bazarr and qBittorrent service plugins configured entirely through the service editor.
- Added compact and expanded Prowlarr indexer activity, Bazarr missing-subtitle and qBittorrent transfer/torrent metrics.
- Added GUI connection tests and provider-specific Docker-network URL guidance for the complete media automation stack.

### Security

- Prowlarr and Bazarr API keys plus qBittorrent Web UI credentials stay in the server-only credential store.
- Provider requests are read-only, size-bounded, cached and protected by an eight-second timeout; qBittorrent session cookies never enter dashboard data or logs.

## [0.10.0] - 2026-09-03

### Added

- Added native Radarr and Sonarr service plugins configured entirely through the service editor.
- Added compact and expanded library, monitored, wanted, queue and download metrics.
- Added shared GUI connection testing for both providers with provider-specific defaults and guidance.

### Security

- Radarr and Sonarr API keys stay in the server-side credential store and are sent only through the `X-Api-Key` header.
- Provider requests are read-only, size-bounded, cached and protected by an eight-second timeout.

## [0.9.0] - 2026-09-03

### Added

- Added a native Jellyfin service plugin configured entirely through the service editor.
- Added API-key authentication, connection testing and compact or expanded dashboard presentation.
- Added live playback, connected-session, transcoding, movie, series, episode and music-library metrics.

### Security

- Jellyfin API keys stay in the server-side credential store and are sent only through the Jellyfin MediaBrowser authorization header.
- Jellyfin requests are read-only, size-bounded, cached and protected by an eight-second timeout.

## [0.8.1] - 2026-09-02

### Fixed

- Expanded Portainer cards in **All environments** mode now aggregate running, total, healthy and stopped containers across every reachable online environment.
- All-environment Portainer cards now include the accessible stack count instead of repeating only the environment summary.
- A temporarily unreachable environment no longer hides metrics collected successfully from the remaining environments.

## [0.8.0] - 2026-09-02

### Added

- Added a native Portainer service plugin configured entirely through the service editor.
- Added access-token authentication, connection testing and environment selection through the GUI.
- Added compact and expanded Portainer presentations with environment, container health and stack counts.

### Changed

- Service credentials are now bound to their provider so a secret stored for one plugin can never be reused by another plugin after switching providers.

### Security

- Portainer access tokens remain server-side and are excluded from public dashboard data, revisions, backups and error messages.
- Portainer requests are read-only, size-bounded, cached and protected by an eight-second timeout.

## [0.7.0] - 2026-09-02

### Added

- Added a shared service-plugin data model, validation layer, credential store and API foundation for future native integrations.
- Added General, Status and Plugin sections to the service editor, with Beszel configured directly on its service.
- Added compact and expanded Beszel presentations rendered inline inside the service card.

### Changed

- Removed Beszel from the new-widget catalog because native provider data now belongs to Services; unmatched legacy Beszel widgets remain supported.
- Existing standalone Beszel widgets automatically migrate to a matching Beszel service, including their server-only credentials.
- Dashboard masonry sizing now accounts for inline plugin content.

### Security

- Service-plugin credentials remain isolated in the server-side database and are excluded from the public dashboard payload, revisions and JSON backups.

## [0.6.0] - 2026-09-02

### Added

- Added the first native service integration: a Beszel widget with all-systems overview and single-system CPU, memory, disk and status metrics.
- Added GUI-only Beszel setup, connection testing and system selection for both current and legacy Beszel authentication endpoints.
- Added server-only widget credentials that are excluded from the public dashboard API, revisions and JSON backups.

### Changed

- Beszel requests now use bounded responses, an eight-second timeout and an in-memory authentication token cache.
- Native integration cards include responsive loading, unavailable and live-data states.

## [0.5.0] - 2026-09-01

### Added

- Added a GUI widget catalog with revision-backed creation and deletion.
- Added widget ordering controls and a useful empty state when no widgets are configured.
- Added dashboard rendering for the existing Docker status widget with summary and detailed health modes.

### Changed

- Made widget records the single source of truth for Search, Clock and Weather visibility and configuration while preserving legacy backup fields.
- Moved all header-widget controls into the Widgets section and replaced duplicate Dashboard toggles with a read-only overview.
- Added a one-time database migration that preserves existing visibility, clock and weather choices.

### Fixed

- Prevented Custom API widgets from crashing the dashboard when a selected value is an object or another non-primitive JSON value.
- Avoided unnecessary Custom API refetches when unrelated dashboard polling updates arrive.

## [0.4.1] - 2026-09-01

### Fixed

- Made a manually entered group icon apply when the field loses focus or when Enter is pressed, matching gallery and upload behavior.
- Prevented the field blur and **Save group** click from creating duplicate saves for the same group icon change.
- Made clearing an applied group icon persist immediately through the same picker workflow.

## [0.4.0] - 2026-08-28

### Added

- Replaced the row-sized dashboard grid with dense masonry-style packing so short groups no longer leave large accidental holes below tall neighbours.
- Added per-group desktop start-column placement and deliberate space-before presets to the visual **Appearance → Layout studio** editor.
- Added automatic SQLite migration, revision/backup compatibility and responsive rendering for the new layout fields.

### Fixed

- Made a group icon chosen from the Homarr gallery or uploaded through the picker save immediately, including the Entertainment group and other groups without an existing icon.
- Routed manually entered `mdi-*` and `si-*` SVG icons through a cached, allowlisted same-origin server proxy with pinned external fallback sources.

### Changed

- Reworked the layout editor into a tighter visual studio with column lanes, selected-group controls, automatic packing and a one-click **Tight pack** action.

## [0.3.2] - 2026-08-28

### Fixed

- Made manually entered `mdi-*` and `si-*` icons load through a pinned fallback CDN and convert trusted SVG responses to local data masks before rendering.
- Added immediate loading, success, and failure feedback to manual icon fields instead of silently falling back to initials.

### Changed

- Moved the dashboard column, group width, density, preview, reorder, and reset controls into one wide **Appearance → Dashboard layout** editor.
- Simplified the Services group inspector so it only edits group properties.

## [0.3.1] - 2026-08-28

### Fixed

- Normalized manually entered dashboard, `mdi-*`, `si-*`, and `sh-*` icon references before previewing and saving them.
- Moved the global desktop column count into the Services grid editor so it is saved atomically with group widths.
- Limited group-width choices to the active grid, clamped existing spans when columns are reduced, and made grid reset restore a coherent three-column default.

## [0.3.0] - 2026-08-27

### Added

- Added the compatible group-width data foundation for the upcoming visual grid editor.
- Added accessible group-width controls with an immediate dashboard-layout preview in the web editor.
- Added two-dimensional drag-and-drop ordering and a revision-backed reset for group layouts.

### Changed

- Made dashboard group rendering deterministic and responsive, with saved widths safely clamped to one through six active columns.

## [0.2.1] - 2026-08-26

### Fixed

- Kept the icon name or URL field readable after adding the Browse and Upload actions.
- Preserved the same icon-picker layout for group and service editors and retained the mobile full-width actions.

### Documentation

- Added the complete Docker Compose and Portainer deployment procedure to the README.
- Established continuous MAJOR.MINOR.PATCH versioning and synchronized the application, API and Docker image version.

## [0.2.0] - 2026-08-24

### Added

- Docker-connection selection from stored integrations and opt-in service status indicators.
- Automatic status refresh, corrected 12/24-hour clock formatting, Dashcenter branding and favicon assets.
- Searchable GUI icon library, editable group icons and direct PNG/JPEG/WebP/GIF uploads.
- Homepage `settings.yaml` import/export for group icons and ordering.
- AGPL-3.0-only licensing foundation, third-party notices and asset provenance.

### Security

- Added bounded structural validation for uploaded images and conservative cleanup of unreferenced uploads.
- Kept Docker discovery behind the read-only socket proxy.

## [0.1.0] - 2026-08-14

### Added

- Initial GUI-managed self-hosted dashboard release.
- Dashboard groups, services, bookmarks, appearance controls, Docker discovery, Homepage import, SQLite persistence, backups and authentication.
