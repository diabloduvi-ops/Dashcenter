<p align="center">
  <img src="public/assets/dashcenter-mark.svg" alt="Dashcenter logo" width="96" height="96" />
</p>

# Dashcenter

**Current release: v1.0.3**

Dashcenter is a self-hosted start page and service dashboard managed from the browser. It combines links, service status, Docker metadata, native service integrations and flexible widgets in one responsive board without requiring users to maintain YAML for everyday changes.

Dashcenter is an independent project inspired by the clarity of Homepage. It is not affiliated with, endorsed by, or maintained by Homepage or its maintainers.

## Highlights

- Browser-based setup and administration
- One measured responsive board for service groups and dashboard widgets, without overlap or empty full-row bands
- Direct layout editing on the real dashboard with stable drag-and-drop, resize handles, Undo/Redo and exact position controls
- Three-pane service administration with searchable groups and services, focused plugin forms and live dashboard-card previews
- Responsive multi-column or single-column service rows for every group, with full-width native plugin content
- Versioned Forest, Graphite, Nord and Warm appearance presets with semantic color, surface, type, motion and icon controls
- Compact top-bar modules for search, time, weather, host resources and service availability
- Dashboard cards for server health, service health, Jellyfin/Plex activity, MikroTik network traffic, Docker status, calendars, RSS/Atom feeds and custom JSON APIs
- Native service plugins for Beszel, Portainer, Proxmox VE, Uptime Kuma, Jellyfin, Plex, MikroTik, Radarr, Sonarr, Lidarr, Prowlarr, Bazarr, qBittorrent, Nginx Proxy Manager and Steam wishlist deals
- Homepage-compatible service import and export
- SQLite persistence, automatic revisions and JSON backup/restore
- Server-side credential storage and first-run administrator setup

## Choose a deployment method

| Method | Best for | Docker metadata |
| --- | --- | --- |
| Docker Compose | Most self-hosted installations | Included through the restricted metadata gateway |
| Portainer Stack | GUI-managed Docker environments | Included through the same restricted gateway |
| Dashboard-only container | Hosts that do not need local Docker discovery | Disabled unless an external connection is added |
| Node.js from source | Development and contributions | Optional |

All deployment methods use the same application and **/data** layout. Docker discovery is optional; links, widgets and native HTTP integrations continue to work without it.

## Access and privacy

Anyone who can reach Dashcenter can view the published dashboard, its visible service links and data shown by enabled widgets and plugins. Editing and administration require the account created during first-run setup. Hidden groups and services, disabled widgets, private feed URLs, provider credentials and Docker connection endpoints are excluded from anonymous dashboard responses. Keep sensitive information out of service names, descriptions and links that you choose to publish.

Complete the first-run administrator setup on a trusted network before making the dashboard reachable from the internet. Failed logins are temporarily throttled, and signed-in image uploads share a limit of 12 requests per account per minute across all upload forms. Internet-facing installations should also use HTTPS and a trusted reverse proxy. JSON configuration backups omit server-side credentials and uploaded files, but they still contain service links and internal connection settings; store them privately.

## Requirements

For container deployments:

- Docker Engine with Docker Compose v2, Portainer or another OCI-compatible runtime
- A persistent volume or directory mounted at **/data**
- One available host port
- HTTPS through a trusted reverse proxy for internet-facing installations, or a trusted LAN/VPN for HTTP-only access

For source development, use Node.js 24 or newer and pnpm 11.

## Docker Compose

Clone the repository and create the local environment file:

~~~bash
git clone https://github.com/diabloduvi-ops/Dashcenter.git
cd Dashcenter
cp .env.example .env
~~~

For a trusted LAN or VPN over plain HTTP:

~~~dotenv
DASHCENTER_PORT=3000
TZ=Europe/Bratislava
TRUST_PROXY=false
SESSION_COOKIE_SECURE=false
DASHCENTER_REVISION=unknown
~~~

For an HTTPS reverse proxy:

~~~dotenv
DASHCENTER_PORT=3000
TZ=Europe/Bratislava
TRUST_PROXY=true
SESSION_COOKIE_SECURE=true
DASHCENTER_REVISION=unknown
~~~

Validate, build and start the complete stack:

~~~bash
docker compose config
DASHCENTER_REVISION="$(git rev-parse HEAD)" docker compose up -d --build
docker compose ps
~~~

Open **http://your-server:3000**, or the hostname configured in your reverse proxy. The first visitor creates the administrator account.

The complete Compose stack starts:

- **dashboard**, the Dashcenter application
- **dockerproxy**, an internal Docker metadata gateway
- **dashcenter_data**, the persistent named volume

To run only Dashcenter without mounting the Docker socket into any companion container:

~~~bash
docker compose up -d --build --no-deps dashboard
~~~

Docker-backed service status and discovery remain unavailable until you add a reachable Docker API connection. Every other feature remains usable.

## Portainer Stack

Create a Portainer stack from the repository:

1. Open **Stacks → Add stack** and choose **Repository**.
2. Set **Repository URL** to https://github.com/diabloduvi-ops/Dashcenter.git.
3. Use a published tag such as **refs/tags/v1.0.3** for controlled upgrades, or **refs/heads/main** for continuous updates.
4. Set **Compose path** to **docker-compose.yml**.
5. Add **DASHCENTER_PORT**, **TZ**, **TRUST_PROXY**, **SESSION_COOKIE_SECURE** and, optionally, **DASHCENTER_REVISION**.
6. Deploy the stack and open the selected port or reverse-proxy hostname.

Portainer deploys the following Docker Compose definition from the repository:

~~~yaml
name: dashcenter

services:
  dashboard:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        DASHCENTER_VERSION: "1.0.3"
        DASHCENTER_REVISION: "${DASHCENTER_REVISION:-unknown}"
    image: dashcenter:1.0.3
    pull_policy: build
    container_name: dashcenter
    restart: unless-stopped
    ports:
      - "${DASHCENTER_PORT:-3000}:3000"
    environment:
      TZ: ${TZ:-UTC}
      DATA_DIR: /data
      PORT: 3000
      TRUST_PROXY: "${TRUST_PROXY:-false}"
      SESSION_COOKIE_SECURE: "${SESSION_COOKIE_SECURE:-true}"
    volumes:
      - dashcenter_data:/data
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    depends_on:
      dockerproxy:
        condition: service_started

  dockerproxy:
    build:
      context: .
      dockerfile: docker/Dockerfile.proxy
      args:
        DASHCENTER_VERSION: "1.0.3"
    image: dashcenter-docker-proxy:1.0.3
    pull_policy: build
    container_name: dashcenter-docker-proxy
    restart: unless-stopped
    environment:
      DISABLE_IPV6: 1
      LOG_LEVEL: warning
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    read_only: true
    tmpfs:
      - /run
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  dashcenter_data:
    name: dashcenter_data
~~~

The checked-in [docker-compose.yml](docker-compose.yml) remains the source of truth. Repository deployment is required for this full stack because Portainer builds the application and the restricted Docker gateway from the accompanying Dockerfiles and configuration. Use the dashboard-only container method when deploying through the Web editor without repository files.

Use **TRUST_PROXY=true** and **SESSION_COOKIE_SECURE=true** when Portainer places Dashcenter behind HTTPS. Use both values as **false** only on a trusted HTTP LAN or VPN.

## Dashboard-only container

Build the application image directly when you already manage networking, reverse proxying or monitoring elsewhere:

~~~bash
docker build \
  --build-arg DASHCENTER_VERSION=1.0.3 \
  --build-arg DASHCENTER_REVISION="$(git rev-parse HEAD)" \
  -t dashcenter:1.0.3 .
~~~

Run it with a named volume:

~~~bash
docker run -d \
  --name dashcenter \
  --restart unless-stopped \
  --read-only \
  --tmpfs /tmp:size=64m,mode=1777 \
  --security-opt no-new-privileges:true \
  --cap-drop ALL \
  -p 3000:3000 \
  -e DATA_DIR=/data \
  -e PORT=3000 \
  -e TZ=UTC \
  -e TRUST_PROXY=false \
  -e SESSION_COOKIE_SECURE=false \
  -v dashcenter_data:/data \
  dashcenter:1.0.3
~~~

Adapt the cookie and proxy settings before exposing the container through HTTPS. The same image can run in other OCI-compatible platforms as long as **/data** is writable and persistent.

## Docker metadata connections

The bundled gateway is available inside the Compose network at **http://dockerproxy:2375**. Add it under **Settings → Connections → Docker** as a **Remote Docker API** connection.

The supplied HAProxy policy accepts GET requests only for:

- **/_ping**
- **/version**
- **/containers/json**
- **/containers/{id}/json**

All other Docker API routes are denied. The gateway has no published host port and must not be shared with unrelated containers.

You can instead connect Dashcenter to a protected remote Docker API. Keep it on a trusted private network or use TLS. Never expose an unauthenticated Docker API such as public port 2375.

## Reverse proxy

Forward the chosen hostname to **http://docker-host:DASHCENTER_PORT** and use a valid TLS certificate. Set:

~~~dotenv
TRUST_PROXY=true
SESSION_COOKIE_SECURE=true
~~~

For Nginx Proxy Manager, Caddy, Traefik or another proxy, preserve the original host and forwarded protocol headers. If login immediately returns to the login screen, verify that the cookie setting matches the actual HTTP or HTTPS connection.
When **TRUST_PROXY=true**, accept traffic on the Dashcenter port only from that trusted proxy; forwarded client addresses are also used for login throttling.

## Persistent data and backups

Dashcenter keeps production data under **/data**:

- **app.db** contains configuration, users and server-side integration credentials
- **uploads/** contains uploaded icons and backgrounds

The web editor can download and restore a portable JSON configuration backup. JSON backups exclude uploaded binary files and server-side credentials.

For complete migration or disaster recovery, back up the entire **/data** volume. The following example briefly stops Dashcenter so the SQLite database and uploads are copied consistently:

~~~bash
docker compose stop dashboard
docker run --rm \
  -v dashcenter_data:/data:ro \
  -v "$PWD":/backup \
  alpine:3.22 \
  tar -czf /backup/dashcenter-data.tar.gz -C /data .
docker compose start dashboard
~~~

Keep complete backups outside the Docker host and test restoration. Do not use **docker compose down -v** unless you intentionally want to delete the persistent volume.

## Updates

For a command-line deployment:

~~~bash
git pull --ff-only
DASHCENTER_REVISION="$(git rev-parse HEAD)" docker compose up -d --build
~~~

For Portainer, pull and redeploy the stack or enable GitOps polling. Database migrations run automatically and normal rebuilds preserve the named volume.

Review [CHANGELOG.md](CHANGELOG.md) before updating. A release tag identifies the exact source for a published version. The application version and source revision are also available from **/api/healthz** and the OCI image labels.

## Homepage import

Open **Settings → Connections → Homepage migration**. Paste or upload **services.yaml**, optionally add **settings.yaml**, preview the mapping and confirm the import.

The importer preserves supported service fields, Docker references and matching category icons. Example files under **examples/homepage/** use reserved demo domains and contain no private addresses or personal links.

## Development

Install dependencies and start both the API and frontend development servers:

~~~bash
pnpm install
pnpm dev
~~~

Run the complete local verification set:

~~~bash
pnpm test
pnpm build
pnpm licenses:check
docker compose config
docker build -t dashcenter:test .
~~~

## Issues and feature requests

Use [GitHub Issues](https://github.com/diabloduvi-ops/Dashcenter/issues/new/choose) for reproducible bugs and feature requests. Search existing issues first and keep one topic per issue.

Do not publish suspected vulnerabilities or sensitive deployment data. Follow [SECURITY.md](SECURITY.md) and use GitHub private vulnerability reporting.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Changes must include suitable validation and must preserve third-party attribution, credential privacy and backward compatibility unless a breaking change is explicitly documented.

## Versioning and source mapping

Dashcenter follows semantic versioning:

- **MAJOR** for incompatible changes and the first stable 1.0.0 release
- **MINOR** for completed backward-compatible capabilities
- **PATCH** for fixes and small compatibility or deployment corrections

Every release synchronizes the application, health API, Docker image tag, README and changelog. Container builds accept **DASHCENTER_REVISION** and record it in the OCI **org.opencontainers.image.revision** label.

## Licence and provenance

Dashcenter source code and project-specific assets are licensed under [GNU Affero General Public License v3.0 only](LICENSE) (**AGPL-3.0-only**) unless stated otherwise.

If you modify Dashcenter and allow users to interact with the modified version over a network, the AGPL requires offering those users the corresponding source.

Third-party packages, icon collections, service names, logos and test fixtures retain their own terms. See:

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- [Production dependency licences](docs/DEPENDENCY_LICENSES.md)
- [Asset provenance](docs/ASSET_PROVENANCE.md)
- [Source provenance audit](docs/SOURCE_PROVENANCE.md)
