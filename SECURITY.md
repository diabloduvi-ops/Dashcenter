# Security policy

## Supported versions

Security fixes are provided for the latest released Dashcenter version. Upgrade to the current release before reporting a problem that may already be fixed.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include credentials, private URLs, database contents, session cookies or production logs in an issue.

Use [GitHub private vulnerability reporting](https://github.com/diabloduvi-ops/Dashcenter/security/advisories/new). Include:

- the Dashcenter version and source revision from `/api/healthz`;
- the deployment method and relevant configuration with secrets removed;
- clear reproduction steps and the expected security impact;
- any proposed mitigation or patch, if available.

Use the regular issue forms for non-sensitive bugs and feature requests.

## Deployment boundary

Dashcenter stores administrator sessions and integration credentials on the server. Public deployments must use HTTPS and must not expose an unfinished first-run setup. Protect `/data`, keep provider tokens read-only where possible and never expose an unauthenticated Docker API publicly.

The bundled Docker metadata gateway is reachable only inside the Compose network and permits GET requests to `/_ping`, `/version` and `/containers/json`. Container inspect is blocked because it exposes environment variables. Do not replace the supplied HAProxy configuration with the upstream broad `CONTAINERS=1` policy.
