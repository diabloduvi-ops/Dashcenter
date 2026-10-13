# Contributing to Dashcenter

Thank you for improving Dashcenter. Keep contributions focused, reviewable and safe for people who run the application on their own infrastructure.

## Issues and feature planning

Use the GitHub issue forms for reproducible bugs and feature requests. Search existing issues first, keep one problem or request per issue and explain the user-visible outcome. Do not use issues for suspected vulnerabilities; follow `SECURITY.md` instead.

## Development workflow

1. Create a focused branch and pull request.
2. Explain the user-visible change, risks and any migration impact.
3. Add or update tests for changed behaviour.
4. Before requesting review, run:

```bash
pnpm test
pnpm build
pnpm licenses:check
docker compose config
docker compose -f compose.ghcr.yml config
```

Never commit passwords, API tokens, private URLs, database files, uploaded user data or other personal information.

## Contribution licence and rights

Dashcenter is licensed under `AGPL-3.0-only`. By submitting a contribution, you certify that:

- you wrote it or otherwise have the necessary rights to submit it;
- you are permitted to license it as part of Dashcenter under `AGPL-3.0-only`;
- you understand that accepted contributions are publicly distributed under that licence.

Dashcenter does not currently require a separate contributor licence agreement.

Preserve existing copyright, attribution and SPDX notices. Do not paste code, tests, images or documentation from Homepage or another project unless its exact source and licence are documented and compatibility has been reviewed. Link every material third-party source in the pull request and update `THIRD_PARTY_NOTICES.md` when needed.

## AI-assisted contributions

AI tools may assist a contribution, but a human contributor remains responsible for it.

- Review and understand every submitted line.
- Run the same tests and security checks as for human-written code.
- Disclose material AI assistance and any external references in the pull request.
- Reject output containing unexplained copyright/SPDX headers or suspiciously source-like passages until provenance and licence compatibility are verified.
- Never give an AI tool repository secrets, production data or personal information.
- Do not describe AI output as guaranteed original.

## Assets and design files

Only submit assets you created or are authorised to redistribute. Record the contributor, creation method, source inputs, date, licence and a SHA-256 checksum in `docs/ASSET_PROVENANCE.md`. Third-party logos and icons must retain their upstream attribution and trademark status.

The repository does not keep a private next-release document. Accepted plans, known defects and follow-up work belong in GitHub Issues so contributors can discover and discuss them.
