# Source provenance audit

Audit date: 2026-09-13  
Audited base: Dashcenter source and distributed assets prepared for the public repository.

## Scope and method

This technical review covered the source, tests, documentation, configuration, distributed assets and production dependency graph present before the public-repository preparation release.

The review:

1. inventoried repository files and searched source and documentation for foreign copyright, licence and provenance markers;
2. traced every distributed non-code asset to project history or a pinned upstream revision;
3. generated a complete production dependency licence inventory from the lockfile-resolved installation;
4. reviewed the Docker base, companion image, OCI labels and release-version checks;
5. compared selected distinctive Dashcenter symbols and user-interface phrases against the current `gethomepage/homepage` code index.

## Findings

- No imported Homepage source file, foreign copyright header or unexplained copied code block was identified.
- The shared concepts are explicitly documented: service groups, Homepage YAML interoperability and compatible icon prefixes. Dashcenter implements these concepts in its own Fastify, SQLite and React architecture.
- Selected project-specific symbols and phrases produced no matching Homepage implementation. One generic phrase, “Widget order updated”, appeared only as unrelated translation text and was not evidence of shared implementation.
- The generated forest background, Dashcenter vector mark, icon filename catalog and upstream image test fixtures have recorded provenance and checksums.
- Remote icon collections are pinned and attributed. Their licence texts and brand-use disclaimer are included with the distribution.
- All lockfile-resolved production packages are listed in `docs/DEPENDENCY_LICENSES.md`; CI verifies that the generated inventory stays current.
- The runtime image carries the project licence, third-party notices, provenance records and an OCI source revision supplied by CI or the builder.

## Compatibility boundary

Homepage YAML keys, Docker API routes, service-provider API fields and icon prefixes are interoperability identifiers. Contributions must not copy upstream implementation code to add compatibility. Any intentional third-party code or asset must retain its source, licence and notices and must be called out in its pull request.

## Ongoing control

This audit records the reviewed repository state. Future pull requests remain subject to `CONTRIBUTING.md`, the generated dependency inventory check, asset-provenance requirements and code review. A technical similarity search reduces provenance uncertainty but cannot prove that independently written code is legally unique.
