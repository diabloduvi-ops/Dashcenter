import assert from "node:assert/strict";
import test from "node:test";
import {
  exportHomepageSettingsYaml,
  exportHomepageYaml,
  HomepageYamlError,
  parseHomepageYaml,
} from "./homepage-yaml.js";

const SAMPLE = `
- Docker:
    - Portainer:
        icon: portainer.png
        href: https://portainer.example.com
        description: Docker management
        server: docker-local
        container: portainer
        widget:
          type: portainer
          url: https://portainer.example.com
- Cloud:
    - ChatGPT:
        href: https://chatgpt.com/
        description: AI chat
`;

test("Homepage YAML parser imports groups and preserves unknown service fields", () => {
  const preview = parseHomepageYaml(SAMPLE);
  assert.equal(preview.stats.groups, 2);
  assert.equal(preview.stats.services, 2);
  assert.equal(preview.stats.preservedFields, 1);
  assert.ok(preview.groups.every((group) => group.icon === ""));
  assert.ok(preview.groups.every((group) => group.columnSpan === 1));
  assert.equal(preview.stats.groupIcons, 0);
  assert.equal(preview.groups[0].services[0].dockerServer, "docker-local");
  assert.deepEqual(preview.groups[0].services[0].legacyConfig?.widget, {
    type: "portainer",
    url: "https://portainer.example.com",
  });
});

test("Homepage YAML export can be imported again without losing legacy fields", () => {
  const imported = parseHomepageYaml(SAMPLE);
  const exported = exportHomepageYaml(imported.groups);
  const roundTrip = parseHomepageYaml(exported);
  assert.equal(roundTrip.groups[0].name, "Docker");
  assert.deepEqual(roundTrip.groups[0].services[0].legacyConfig?.widget, {
    type: "portainer",
    url: "https://portainer.example.com",
  });
});

test("Homepage YAML parser rejects invalid and non-http service URLs", () => {
  assert.throws(() => parseHomepageYaml("title: nope"), HomepageYamlError);
  const preview = parseHomepageYaml(`
- Unsafe:
    - Local file:
        href: file:///etc/passwd
`);
  assert.equal(preview.stats.services, 0);
  assert.match(preview.warnings[0], /http:\/\/ or https:\/\//);
});

test("Homepage YAML round-trip preserves Homepage icon prefixes", () => {
  const imported = parseHomepageYaml(`
- Icons:
    - TickTick:
        icon: sh-ticktick.png
        href: https://ticktick.com/
    - GitHub:
        icon: si-github-#ffffff
        href: https://github.com/
`);
  const roundTrip = parseHomepageYaml(exportHomepageYaml(imported.groups));
  assert.equal(roundTrip.groups[0].services[0].icon, "sh-ticktick.png");
  assert.equal(roundTrip.groups[0].services[1].icon, "si-github-#ffffff");
});

test("Homepage services YAML stays compatible and does not invent group icon metadata", () => {
  const imported = parseHomepageYaml(SAMPLE);
  imported.groups[0].icon = "mdi-server";
  const exported = exportHomepageYaml(imported.groups);
  assert.doesNotMatch(exported, /mdi-server/);

  const roundTrip = parseHomepageYaml(exported);
  assert.equal(roundTrip.groups[0].icon, "");
});


test("Homepage settings object layout imports exact matching group icons", () => {
  const preview = parseHomepageYaml(SAMPLE, `
layout:
  Docker:
    icon: mdi-docker
  Cloud:
    icon: sh-cloudflare
`);

  assert.equal(preview.groups[0].icon, "mdi-docker");
  assert.equal(preview.groups[1].icon, "sh-cloudflare");
  assert.equal(preview.stats.groupIcons, 2);
  assert.match(preview.settingsSource ?? "", /layout:/);
});

test("Homepage settings ordered layout imports icons and reports unmatched groups", () => {
  const preview = parseHomepageYaml(SAMPLE, `
layout:
  - Docker:
      icon: mdi-server
      style: row
  - cloud:
      icon: mdi-cloud
  - Bookmarks:
      icon: mdi-bookmark
`);

  assert.equal(preview.groups[0].icon, "mdi-server");
  assert.equal(preview.groups[1].icon, "");
  assert.equal(preview.stats.groupIcons, 1);
  assert.ok(preview.warnings.some((warning) => /2 settings\.yaml group icons/.test(warning)));
});

test("Homepage settings parser validates layout and skips invalid icon values", () => {
  assert.throws(
    () => parseHomepageYaml(SAMPLE, "layout: invalid"),
    HomepageYamlError,
  );

  const preview = parseHomepageYaml(SAMPLE, `
layout:
  Docker:
    icon: ""
  Cloud:
    icon: ${"x".repeat(513)}
`);
  assert.equal(preview.stats.groupIcons, 0);
  assert.equal(preview.warnings.length, 2);
});

test("Homepage settings export preserves group order and round-trips category icons", () => {
  const imported = parseHomepageYaml(SAMPLE);
  imported.groups[0].position = 2;
  imported.groups[0].icon = "mdi-docker";
  imported.groups[1].position = 1;

  const settingsYaml = exportHomepageSettingsYaml(imported.groups);
  assert.ok(settingsYaml.indexOf("- Cloud:") < settingsYaml.indexOf("- Docker:"));
  assert.match(settingsYaml, /Cloud: \{\}/);
  assert.match(settingsYaml, /icon: mdi-docker/);

  const roundTrip = parseHomepageYaml(exportHomepageYaml(imported.groups), settingsYaml);
  assert.equal(roundTrip.groups.find((group) => group.name === "Docker")?.icon, "mdi-docker");
  assert.equal(roundTrip.groups.find((group) => group.name === "Cloud")?.icon, "");
});
