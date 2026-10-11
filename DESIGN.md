---
name: Dashcenter design system
status: accepted
updated: 2026-09-28
---

# Design intent

Dashcenter is a calm, self-hosted control surface for services, infrastructure, and useful live data. It should feel deliberate and capable without looking like a generic enterprise admin panel. The published dashboard keeps its forest-backed, dark glass identity. The editor uses the same visual language with less transparency and stronger information hierarchy.

The primary design rule is ownership: every setting must appear beside the object it changes. Features must not be added as detached panels simply because a screen has available space.

## Product model and hierarchy

Dashcenter has four distinct object types:

1. **Dashboard** — global header elements, group arrangement, responsive layout, and published-dashboard behavior.
2. **Service** — name, URL, description, icon, visibility, health source, and an optional native plugin.
3. **Connection** — reusable access to Docker or another external system. Connections are infrastructure, not dashboard content.
4. **Appearance** — visual tokens, typography, surfaces, icons, imagery, and motion only.

Native plugins such as Beszel, Uptime Kuma, Portainer, Proxmox, Jellyfin, and the Arr applications extend a service. They are configured in the selected service inspector and render inside that service's dashboard card. Search, clock, weather, and similar global elements belong to Dashboard rather than the service plugin catalog.

## Editor information architecture

Primary navigation:

- **Dashboard** — header modules, group canvas, layout, density, and responsive order.
- **Services** — groups, services, service health, and native service plugins.
- **Appearance** — theme presets and graphical customization.
- **Connections** — Docker hosts and future reusable external connections.
- **Users** — accounts and access.
- **Backups** — export, restore, and retention.

Do not add a standalone Widgets or Integrations destination for functionality that belongs to a service. Homepage import/export is a migration action under Dashboard or Connections, not a permanent top-level workspace.

### Services workspace

Use three stable panes on desktop:

- group list;
- service list for the selected group;
- a wide inspector for the selected service.

The service inspector uses four tabs:

- **General** — name, URL, description, icon, group, and visibility;
- **Status** — status indicator, Docker connection, container, or an uptime source;
- **Plugin** — optional native provider, credentials, test action, data selection, and live preview;
- **Layout** — per-service display mode, card size, and plugin presentation.

Group editing stays in the group list or a focused group inspector. Service plugin credentials must never share a narrow sidebar with unrelated widget cards.

### Dashboard workspace

Dashboard owns the visual arrangement of service groups and dashboard widgets. **Settings** is the single published-dashboard entry point to the dedicated Dashboard workspace; there is no duplicate Edit layout action or separate light-mode toggle. The workspace follows the approved editor render: the stable administration sidebar stays on the left, the real dashboard modules live on a central canvas, and Add/Selected tools live in a fixed inspector on the right. Users move and resize the real modules with visible handles, select exact width, height and start-column values in the inspector, switch among desktop, tablet, and mobile previews, and review the final content before saving. The workspace has an explicit Save layout action and a Close editor action that returns to the published dashboard.

The central canvas includes a read-only representation of the configured header and the same Forest-backed surface as the published board. At narrower editor widths it preserves a readable minimum width per desktop column and scrolls horizontally instead of compressing service labels or plugin content. Selection and drag/resize controls must not cover plugin details; direct card selection is keyboard accessible.

Dragging uses a stable swap model. Other modules remain still while the pointer moves, the destination is shown on the real card, and the order changes only after drop. The editor provides Save, Cancel, Undo and Redo; automatic dashboard refresh pauses while a draft is active. Keyboard users receive the same reorder path through the sortable move handles and explicit inspector controls.

Automatic-height modules use one measured grid. Their actual rendered height determines placement, so shorter columns accept following modules without estimates, overlap or full-row blank areas. A saved height of one through three rows acts as a minimum size and must never clip dynamic plugin or widget content. Saved column starts and spans stay inside the configured one-to-six-column board.

Each service group chooses one of two flows while keeping one consistent service anatomy. **Horizontal** places compact, elongated service rows into as many columns as the group width can comfortably support. **Vertical** keeps the same rows in one column. Plugin services span the full group width in both flows and always respect their saved summary or expanded presentation. On narrow screens both flows resolve to one service row per line.

Module shells use the same neutral outer border. Health colors belong to the explicit status dot, text, badge and group icon treatment rather than the whole panel edge.

The October 2026 visual-unity direction restores one shared, lightly veiled shell around every service group. The shell uses roughly four-fifths of the configured panel opacity, the configured blur, a neutral border, and compact inner spacing. It must leave the Forest image visible through the group and in the gutters. Group headers are part of this shell rather than a second raised card. Service rows inside use a darker translucent surface; all dashboard widgets use the same outer radius and neutral frame. A service's full plugin content, especially Steam wishlist artwork, discounts, prices and ratings, determines the card height and is never clipped to meet a grid minimum. The currently saved accent remains user-owned, while the Forest preset uses calm mint `#4ee28a`.

Global header modules — brand, search, clock, weather, and system summary — are managed here. Each module can be enabled, reordered, and configured without being confused with a service plugin.

### Appearance workspace

Appearance changes visuals only. It must never contain service or group placement.

Use a live dashboard preview beside a settings inspector with these sections:

- **Theme** — presets, background, semantic colors;
- **Typography** — UI family, scale, weight, number style, and contrast;
- **Surfaces** — opacity, blur, border strength, radius, shadow, and density;
- **Icons** — source preference, size, frame shape, original/monochrome treatment, and group icon style;
- **Motion** — transition level with a reduced-motion-safe option.

Every customization maps to a semantic token. Avoid arbitrary per-component color pickers that make the interface inconsistent.

The preview renders the current groups, services, widgets, layout and native plugins with the unsaved visual draft. It must not substitute sample categories or sample data. Desktop, tablet and mobile views remain scrollable at a readable scale, and preview interactions never change dashboard content.

## Foundations

### Color roles

The default Forest preset starts from the current identity:

- background: `#06100d`;
- surface: green-tinted near-black with configurable opacity;
- raised surface: one clear elevation above surface;
- primary text: `#f1f6f4`;
- muted text: `#a8b5b1`;
- faint text: `#74827d`;
- accent: `#4ee28a`;
- success, warning, and danger use separate semantic tokens and must not reuse the accent.

Theme presets may alter all tokens together. Manual editing exposes semantic roles rather than raw component selectors. Maintain WCAG AA contrast for normal text and preserve a visible focus color.

The default Forest overlay keeps the background image clearly visible. Configurable panel opacity and background blur remain the primary readability controls instead of relying on an excessively dark fixed tint.

### Typography

Use a licensed, locally bundled variable sans when introduced. Preferred direction: Geist Sans with `ui-sans-serif`, system UI, and Segoe UI fallbacks. Until bundled, retain the existing system stack to avoid a network dependency.

- page title: 24–28 px, 650–700 weight, tight tracking;
- section title: 16–18 px, 600–650 weight;
- body/control text: 14 px, 450–550 weight;
- helper text: 12 px, 450 weight;
- labels: sentence case by default; reserve uppercase tracking for rare navigation eyebrows;
- metrics: tabular numerals.

### Spacing and layout

Use an 8 px base rhythm with 4 px optical adjustments. Desktop editor panes should remain stable while the inspector receives the most space. Inner controls use tighter radii than outer surfaces.

- editor sidebar: approximately 228 px;
- lists: 280–330 px each where space permits;
- inspector: minimum 520 px on wide desktop;
- control height: minimum 40 px desktop, 44 px touch contexts;
- main canvas max width: 1840 px for the published dashboard.

### Surfaces

The published dashboard may use glass over imagery. The editor uses mostly opaque, green-tinted surfaces to preserve legibility and reduce visual nesting. Prefer dividers, grouped fields, and whitespace over a card inside a card.

Radius tiers:

- outer shells: 14–18 px;
- panels: 10–14 px;
- inputs and buttons: 8–10 px;
- small icon frames: 7–9 px.

### Iconography

Keep service brand icons in their original style by default. Use one consistent line-icon family for editor actions and navigation. Users may configure service and group icon size, frame shape, frame background, and original/monochrome treatment through semantic options.

## Components and states

- A service plugin always has: provider selection, setup fields, connection test, data selection, live preview, loading state, inline error state, and save state.
- A successful test does not silently save credentials; the save action remains explicit.
- Destructive actions stay separated from the primary save action.
- Empty plugin state explains what a plugin changes and offers a searchable provider picker.
- Loading states use content-shaped skeletons rather than a generic spinner where practical.
- Error messages are direct, local to the failed section, and never use browser alerts.
- Focus rings remain visible on all interactive controls.

## Responsive behavior

- At 1440 px and wider, use the full three-pane Services workspace.
- Around 768–1200 px, collapse group and service navigation into one master pane while keeping the inspector visible.
- Around 390 px, use a drill-down flow: groups → services → inspector, with persistent back navigation and a sticky save bar.
- The published dashboard remains single-column on narrow screens and must never overflow horizontally.
- Touch targets are at least 44 px where controls are presented on mobile.

## Motion

Use motion only to clarify state changes: 160–220 ms for hover/focus feedback and 220–280 ms for pane transitions. Animate opacity and transforms only. Honor `prefers-reduced-motion` and remove nonessential movement when requested.

## Accessibility

Use semantic navigation, sections, articles, labels, and buttons. Keyboard users must be able to select, reorder, configure, save, and leave every screen. Drag operations require keyboard alternatives. Do not communicate service status by color alone; provide text or an accessible label.

## Implementation constraints

- Preserve React 19, TypeScript, Vite, and the existing CSS architecture.
- Do not introduce a second component framework or styling runtime.
- Build tokens as CSS custom properties shared by dashboard and editor.
- Store semantic theme values in the existing settings model and validate them server-side.
- Keep plugin adapters server-side; never expose credentials in public dashboard payloads, revisions, logs, or backups.
- Migrate existing standalone native widgets into service plugins without losing user configuration.

## Visual QA checklist

- Dashboard remains recognizably Dashcenter and retains the Forest preset.
- Appearance contains no service/group placement controls.
- Beszel and other native providers are configured from their service inspector.
- Plugin forms have enough horizontal space and no nested-card clutter.
- Theme changes update the live preview immediately.
- Desktop, tablet, and mobile layouts work at approximately 1440, 768, and 390 CSS pixels.
- Keyboard focus, error, loading, empty, disabled, hover, and reduced-motion states are visible and coherent.

## Provenance

Inspired by selected references from [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) at commit `8147538b4226ae41e2487a9179e3bcc1f68e8554`:

- primary: `cursor` for concise dark-surface product UI;
- secondary: `linear.app` only for compact editor hierarchy and interaction density.

Dashcenter keeps its own brand, copy, assets, and visual identity. No affiliation is implied.

## Accepted visual baseline

The approved visual reference renders are stored in [`docs/design/renders/redesign-v1`](docs/design/renders/redesign-v1).

The renders communicate hierarchy and composition. Existing data, security, backup, plugin, and grid contracts remain authoritative where generated copy or example values differ from the running application.
