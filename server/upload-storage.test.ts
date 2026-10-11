import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase, mutateDashboard } from "./database.js";
import {
  detectImageExtension,
  matchesImageSignature,
  pruneUnusedUploads,
  referencedUploadNames,
  UNUSED_UPLOAD_GRACE_MS,
} from "./upload-storage.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const JPEG = readFileSync(new URL("./fixtures/images/libjpeg-turbo-testorig.jpg", import.meta.url));
const WEBP = readFileSync(new URL("./fixtures/images/libwebp-test.webp", import.meta.url));

const VALID_IMAGES = [
  { mime: "image/png", extension: ".png", buffer: PNG },
  { mime: "image/jpeg", extension: ".jpg", buffer: JPEG },
  { mime: "image/gif", extension: ".gif", buffer: GIF },
  { mime: "image/webp", extension: ".webp", buffer: WEBP },
] as const;

function crc32(buffer: Buffer, start: number, end: number): number {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  let checksum = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    checksum = table[(checksum ^ buffer[offset]) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function findPngChunk(buffer: Buffer, target: string) {
  let offset = 8;
  while (offset <= buffer.length - 12) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === target) return { typeOffset: offset + 4, dataStart, dataEnd };
    offset = dataEnd + 4;
  }
  throw new Error("PNG test chunk not found");
}

test("real image fixtures pass only their matching format", () => {
  for (const image of VALID_IMAGES) {
    assert.equal(detectImageExtension(image.buffer), image.extension, image.mime);
    for (const candidate of VALID_IMAGES) {
      assert.equal(
        matchesImageSignature(image.buffer, candidate.mime),
        image.mime === candidate.mime,
        image.mime + " as " + candidate.mime,
      );
    }
  }
  assert.equal(matchesImageSignature(Buffer.from("not an image"), "application/octet-stream"), false);
});

test("truncated, header-only, oversized, and structurally inconsistent images are rejected", () => {
  const headerOnly = [
    PNG.subarray(0, 8),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    Buffer.from("GIF89a"),
    Buffer.from("RIFF0000WEBP"),
  ];
  for (const sample of headerOnly) assert.equal(detectImageExtension(sample), undefined);

  for (const image of VALID_IMAGES) {
    const boundaries = new Set([0, 1, 8, 12, Math.floor(image.buffer.length / 2), image.buffer.length - 1]);
    for (const length of boundaries) {
      assert.doesNotThrow(() => detectImageExtension(image.buffer.subarray(0, length)));
      assert.equal(detectImageExtension(image.buffer.subarray(0, length)), undefined);
    }
  }

  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
  assert.equal(detectImageExtension(oversized), undefined);

  const badPngCrc = Buffer.from(PNG);
  const idat = findPngChunk(badPngCrc, "IDAT");
  badPngCrc[idat.dataStart] ^= 0x01;
  assert.equal(detectImageExtension(badPngCrc), undefined);

  const oversizedPng = Buffer.from(PNG);
  const ihdr = findPngChunk(oversizedPng, "IHDR");
  oversizedPng.writeUInt32BE(16_385, ihdr.dataStart);
  oversizedPng.writeUInt32BE(crc32(oversizedPng, ihdr.typeOffset, ihdr.dataEnd), ihdr.dataEnd);
  assert.equal(detectImageExtension(oversizedPng), undefined);

  const badGifFrame = Buffer.from(GIF);
  const descriptor = badGifFrame.indexOf(0x2c, 13);
  assert.ok(descriptor >= 0);
  badGifFrame.writeUInt16LE(1, descriptor + 1);
  assert.equal(detectImageExtension(badGifFrame), undefined);

  const badWebpLength = Buffer.from(WEBP);
  badWebpLength.writeUInt32LE(badWebpLength.readUInt32LE(4) - 1, 4);
  assert.equal(detectImageExtension(badWebpLength), undefined);

  const webpImageChunk = WEBP.subarray(12);
  const duplicateWebp = Buffer.concat([WEBP.subarray(0, 12), webpImageChunk, webpImageChunk]);
  duplicateWebp.writeUInt32LE(duplicateWebp.length - 8, 4);
  assert.equal(detectImageExtension(duplicateWebp), undefined);

  assert.equal(detectImageExtension(Buffer.concat([JPEG, Buffer.from([0x00])])), undefined);
});

test("deterministic random buffers never throw or authenticate as images", () => {
  let state = 0x5eed1234;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };

  for (let sample = 0; sample < 128; sample += 1) {
    const buffer = Buffer.alloc(next() % 1024);
    for (let index = 0; index < buffer.length; index += 1) buffer[index] = next() & 0xff;
    assert.doesNotThrow(() => detectImageExtension(buffer));
    assert.equal(detectImageExtension(buffer), undefined);
  }
});

test("upload pruning preserves URL variants in current and revision references", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "dashcenter-upload-prune-"));
  const database = createDatabase(":memory:");
  const historical = "11111111-1111-4111-8111-111111111111.png";
  const current = "22222222-2222-4222-8222-222222222222.png";
  const orphan = "33333333-3333-4333-8333-333333333333.png";
  const recent = "44444444-4444-4444-8444-444444444444.png";
  const unknown = "custom.png";
  const allFiles = [historical, current, orphan, recent, unknown];

  try {
    for (const filename of allFiles) writeFileSync(path.join(directory, filename), "image");

    const firstGroup = database.prepare("SELECT id FROM dashboard_groups ORDER BY position LIMIT 1").get() as {
      id: string;
    };
    mutateDashboard(database, "Historical icon", (transaction) => {
      transaction
        .prepare("UPDATE dashboard_groups SET icon = ? WHERE id = ?")
        .run("https://dashcenter.example/uploads/" + historical + "#old", firstGroup.id);
    });
    mutateDashboard(database, "Current icon", (transaction) => {
      transaction
        .prepare("UPDATE dashboard_groups SET icon = ? WHERE id = ?")
        .run("/uploads/" + current + "?v=2#preview", firstGroup.id);
    });

    const now = Date.now();
    const oldDate = new Date(now - UNUSED_UPLOAD_GRACE_MS - 1_000);
    for (const filename of [historical, current, orphan, unknown]) {
      await utimes(path.join(directory, filename), oldDate, oldDate);
    }

    const references = referencedUploadNames(database);
    assert.ok(references.has(historical));
    assert.ok(references.has(current));

    const removed = await pruneUnusedUploads(database, directory, { now });
    assert.equal(removed, 1);
    assert.equal(existsSync(path.join(directory, orphan)), false);
    assert.equal(existsSync(path.join(directory, historical)), true);
    assert.equal(existsSync(path.join(directory, current)), true);
    assert.equal(existsSync(path.join(directory, recent)), true);
    assert.equal(existsSync(path.join(directory, unknown)), true);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
