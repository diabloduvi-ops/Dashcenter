import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { AppDatabase } from "./database.js";
import { readDashboard } from "./database.js";

const GENERATED_IMAGE_NAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp|gif)$/i;
const GENERATED_IMAGE_URL = new RegExp(`^/uploads/(${GENERATED_IMAGE_NAME.source.slice(1, -1)})$`);
export const UNUSED_UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.subarray(start, end).toString("ascii");
}

export type ImageExtension = ".png" | ".jpg" | ".webp" | ".gif";

const IMAGE_EXTENSION_BY_MIME: Record<string, ImageExtension> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 16_384;
const MAX_IMAGE_PIXELS = 64_000_000;
const MAX_STRUCTURE_ENTRIES = 65_536;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2]);
const JPEG_UNSUPPORTED_START_OF_FRAME_MARKERS = new Set([
  0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[index] = value >>> 0;
}

function dimensionsAreSafe(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_DIMENSION &&
    height <= MAX_IMAGE_DIMENSION &&
    width * height <= MAX_IMAGE_PIXELS
  );
}

function crc32(buffer: Buffer, start: number, end: number): number {
  let checksum = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    checksum = CRC32_TABLE[(checksum ^ buffer[offset]) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function chunkTypeIsSafe(buffer: Buffer, offset: number): boolean {
  for (let index = 0; index < 4; index += 1) {
    const value = buffer[offset + index];
    if (!((value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a))) return false;
  }
  return buffer[offset + 2] >= 0x41 && buffer[offset + 2] <= 0x5a;
}

function validPng(buffer: Buffer): boolean {
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return false;

  let offset = 8;
  let entries = 0;
  let firstChunk = true;
  let sawHeader = false;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let imageDataBytes = 0;
  let colorType = -1;

  while (offset < buffer.length) {
    if (++entries > MAX_STRUCTURE_ENTRIES || offset > buffer.length - 12) return false;
    const length = buffer.readUInt32BE(offset);
    if (length > 0x7fffffff || length > buffer.length - (offset + 12)) return false;
    const typeOffset = offset + 4;
    if (!chunkTypeIsSafe(buffer, typeOffset)) return false;
    const type = ascii(buffer, typeOffset, typeOffset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (crc32(buffer, typeOffset, dataEnd) !== buffer.readUInt32BE(dataEnd)) return false;
    if (firstChunk && type !== "IHDR") return false;
    if (sawImageData && type !== "IDAT" && type !== "IEND") imageDataEnded = true;

    if (type === "IHDR") {
      if (sawHeader || length !== 13) return false;
      const width = buffer.readUInt32BE(dataStart);
      const height = buffer.readUInt32BE(dataStart + 4);
      const bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      const allowedDepths: Record<number, number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !dimensionsAreSafe(width, height) ||
        !allowedDepths[colorType]?.includes(bitDepth) ||
        buffer[dataStart + 10] !== 0 ||
        buffer[dataStart + 11] !== 0 ||
        ![0, 1].includes(buffer[dataStart + 12])
      ) {
        return false;
      }
      sawHeader = true;
    } else if (!sawHeader) {
      return false;
    } else if (type === "PLTE") {
      if (
        sawPalette ||
        sawImageData ||
        colorType === 0 ||
        colorType === 4 ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        return false;
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (imageDataEnded || (colorType === 3 && !sawPalette)) return false;
      if (!sawImageData) {
        if (length < 2) return false;
        const cmf = buffer[dataStart];
        const flags = buffer[dataStart + 1];
        if (
          (cmf & 0x0f) !== 8 ||
          (cmf >>> 4) > 7 ||
          ((cmf << 8) | flags) % 31 !== 0 ||
          (flags & 0x20) !== 0
        ) {
          return false;
        }
      }
      sawImageData = true;
      imageDataBytes += length;
    } else if (type === "IEND") {
      return length === 0 && imageDataBytes > 2 && chunkEnd === buffer.length;
    } else if (buffer[typeOffset] >= 0x41 && buffer[typeOffset] <= 0x5a) {
      return false;
    }

    firstChunk = false;
    offset = chunkEnd;
  }
  return false;
}

function validJpegTableSegment(
  buffer: Buffer,
  marker: number,
  dataStart: number,
  segmentEnd: number,
): boolean {
  let offset = dataStart;
  let tables = 0;

  while (offset < segmentEnd) {
    if (++tables > 16) return false;
    const info = buffer[offset];
    offset += 1;
    if (marker === 0xdb) {
      const precision = info >>> 4;
      if (precision > 1 || (info & 0x0f) > 3) return false;
      const tableBytes = precision === 0 ? 64 : 128;
      if (tableBytes > segmentEnd - offset) return false;
      offset += tableBytes;
      continue;
    }

    const tableClass = info >>> 4;
    if (tableClass > 1 || (info & 0x0f) > 3 || 16 > segmentEnd - offset) return false;
    let symbolCount = 0;
    for (let index = 0; index < 16; index += 1) symbolCount += buffer[offset + index];
    offset += 16;
    if (symbolCount === 0 || symbolCount > 256 || symbolCount > segmentEnd - offset) return false;
    offset += symbolCount;
  }

  return tables > 0 && offset === segmentEnd;
}

function validJpeg(buffer: Buffer): boolean {
  if (
    buffer.length < 12 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer[buffer.length - 2] !== 0xff ||
    buffer[buffer.length - 1] !== 0xd9
  ) {
    return false;
  }

  let offset = 2;
  let entries = 0;
  let frameComponents = 0;
  let sawFrame = false;
  let sawScan = false;
  let sawEntropyData = false;

  while (offset < buffer.length) {
    if (++entries > MAX_STRUCTURE_ENTRIES || buffer[offset] !== 0xff) return false;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return false;
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0x00 || marker === 0xd8) return false;
    if (marker === 0xd9) {
      return sawFrame && sawScan && sawEntropyData && offset === buffer.length;
    }
    if (marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) return false;
    if (offset > buffer.length - 2) return false;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || segmentLength > buffer.length - offset) return false;
    const dataStart = offset + 2;
    const segmentEnd = offset + segmentLength;

    if (JPEG_UNSUPPORTED_START_OF_FRAME_MARKERS.has(marker) || marker === 0xdc) return false;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (sawFrame || segmentLength < 8 || buffer[dataStart] !== 8) return false;
      const height = buffer.readUInt16BE(dataStart + 1);
      const width = buffer.readUInt16BE(dataStart + 3);
      frameComponents = buffer[dataStart + 5];
      if (
        !dimensionsAreSafe(width, height) ||
        frameComponents < 1 ||
        frameComponents > 4 ||
        segmentLength !== 8 + 3 * frameComponents
      ) {
        return false;
      }
      sawFrame = true;
    } else if ((marker === 0xdb || marker === 0xc4) && !validJpegTableSegment(buffer, marker, dataStart, segmentEnd)) {
      return false;
    }

    if (marker !== 0xda) {
      offset = segmentEnd;
      continue;
    }
    if (!sawFrame || segmentLength < 8) return false;

    const scanComponents = buffer[dataStart];
    if (
      scanComponents < 1 ||
      scanComponents > frameComponents ||
      segmentLength !== 6 + 2 * scanComponents
    ) {
      return false;
    }

    sawScan = true;
    offset = segmentEnd;
    let scanHasData = false;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        scanHasData = true;
        offset += 1;
        continue;
      }

      const markerStart = offset;
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      if (offset >= buffer.length) return false;
      const scanMarker = buffer[offset];
      if (scanMarker === 0x00) {
        scanHasData = true;
        offset += 1;
        continue;
      }
      if (scanMarker >= 0xd0 && scanMarker <= 0xd7) {
        offset += 1;
        continue;
      }
      if (!scanHasData) return false;
      sawEntropyData = true;
      offset = markerStart;
      break;
    }
  }

  return false;
}

function readGifSubBlocks(
  buffer: Buffer,
  initialOffset: number,
): { nextOffset: number; dataBytes: number } | undefined {
  let offset = initialOffset;
  let dataBytes = 0;
  let blocks = 0;
  while (offset < buffer.length) {
    if (++blocks > MAX_STRUCTURE_ENTRIES) return undefined;
    const length = buffer[offset];
    offset += 1;
    if (length === 0) return { nextOffset: offset, dataBytes };
    if (offset + length > buffer.length) return undefined;
    dataBytes += length;
    offset += length;
  }
  return undefined;
}

function validGif(buffer: Buffer): boolean {
  if (buffer.length < 14) return false;
  const header = ascii(buffer, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return false;

  const canvasWidth = buffer.readUInt16LE(6);
  const canvasHeight = buffer.readUInt16LE(8);
  if (!dimensionsAreSafe(canvasWidth, canvasHeight)) return false;

  const packed = buffer[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);
  if (offset > buffer.length) return false;

  let entries = 0;
  let sawImage = false;
  while (offset < buffer.length) {
    if (++entries > MAX_STRUCTURE_ENTRIES) return false;
    const blockType = buffer[offset];
    offset += 1;

    if (blockType === 0x3b) return sawImage && offset === buffer.length;
    if (blockType === 0x21) {
      if (offset >= buffer.length) return false;
      const label = buffer[offset];
      offset += 1;

      if (label === 0xf9) {
        if (offset > buffer.length - 6 || buffer[offset] !== 4 || buffer[offset + 5] !== 0) return false;
        offset += 6;
        continue;
      }

      if (label === 0xff || label === 0x01) {
        const requiredHeaderLength = label === 0xff ? 11 : 12;
        if (
          offset >= buffer.length ||
          buffer[offset] !== requiredHeaderLength ||
          requiredHeaderLength + 1 > buffer.length - offset
        ) {
          return false;
        }
        offset += requiredHeaderLength + 1;
      } else if (label !== 0xfe) {
        return false;
      }

      const blocks = readGifSubBlocks(buffer, offset);
      if (!blocks) return false;
      offset = blocks.nextOffset;
      continue;
    }
    if (blockType !== 0x2c || offset > buffer.length - 9) return false;

    const left = buffer.readUInt16LE(offset);
    const top = buffer.readUInt16LE(offset + 2);
    const width = buffer.readUInt16LE(offset + 4);
    const height = buffer.readUInt16LE(offset + 6);
    const imagePacked = buffer[offset + 8];
    if (
      !dimensionsAreSafe(width, height) ||
      left + width > canvasWidth ||
      top + height > canvasHeight
    ) {
      return false;
    }

    offset += 9;
    if (imagePacked & 0x80) offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    if (offset >= buffer.length) return false;
    const minimumCodeSize = buffer[offset];
    offset += 1;
    if (minimumCodeSize < 2 || minimumCodeSize > 8) return false;
    const imageBlocks = readGifSubBlocks(buffer, offset);
    if (!imageBlocks || imageBlocks.dataBytes === 0) return false;
    offset = imageBlocks.nextOffset;
    sawImage = true;
  }

  return false;
}

function readUInt24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function validWebpBitstream(buffer: Buffer, type: string, start: number, size: number): boolean {
  if (type === "VP8 ") {
    if (
      size < 11 ||
      (buffer[start] & 1) !== 0 ||
      buffer[start + 3] !== 0x9d ||
      buffer[start + 4] !== 0x01 ||
      buffer[start + 5] !== 0x2a
    ) {
      return false;
    }
    const frameTag = buffer[start] | (buffer[start + 1] << 8) | (buffer[start + 2] << 16);
    const firstPartitionSize = frameTag >>> 5;
    const width = buffer.readUInt16LE(start + 6) & 0x3fff;
    const height = buffer.readUInt16LE(start + 8) & 0x3fff;
    return (
      firstPartitionSize > 0 &&
      firstPartitionSize <= size - 10 &&
      dimensionsAreSafe(width, height)
    );
  }

  if (type === "VP8L") {
    if (size < 6 || buffer[start] !== 0x2f) return false;
    const bits = buffer.readUInt32LE(start + 1);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    return (bits >>> 29) === 0 && dimensionsAreSafe(width, height);
  }

  return false;
}

function validWebpChunks(
  buffer: Buffer,
  initialOffset: number,
  limit: number,
  allowFrames: boolean,
): { valid: boolean; sawImage: boolean } {
  let offset = initialOffset;
  let entries = 0;
  let sawImage = false;
  let sawExtendedHeader = false;

  while (offset < limit) {
    if (++entries > MAX_STRUCTURE_ENTRIES || offset > limit - 8) {
      return { valid: false, sawImage: false };
    }
    const type = ascii(buffer, offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const paddedEnd = dataEnd + (size & 1);
    if (
      dataEnd < dataStart ||
      paddedEnd > limit ||
      ((size & 1) !== 0 && buffer[dataEnd] !== 0)
    ) {
      return { valid: false, sawImage: false };
    }

    if (type === "VP8 " || type === "VP8L") {
      if (sawImage || !validWebpBitstream(buffer, type, dataStart, size)) {
        return { valid: false, sawImage: false };
      }
      sawImage = true;
    } else if (type === "VP8X") {
      if (
        !allowFrames ||
        sawExtendedHeader ||
        offset !== initialOffset ||
        size !== 10 ||
        (buffer[dataStart] & 0xc1) !== 0 ||
        buffer[dataStart + 1] !== 0 ||
        buffer[dataStart + 2] !== 0 ||
        buffer[dataStart + 3] !== 0
      ) {
        return { valid: false, sawImage: false };
      }
      const width = readUInt24LE(buffer, dataStart + 4) + 1;
      const height = readUInt24LE(buffer, dataStart + 7) + 1;
      if (!dimensionsAreSafe(width, height)) return { valid: false, sawImage: false };
      sawExtendedHeader = true;
    } else if (type === "ANMF") {
      if (!allowFrames || size < 16) return { valid: false, sawImage: false };
      const frameWidth = readUInt24LE(buffer, dataStart + 6) + 1;
      const frameHeight = readUInt24LE(buffer, dataStart + 9) + 1;
      if (!dimensionsAreSafe(frameWidth, frameHeight)) return { valid: false, sawImage: false };
      const nested = validWebpChunks(buffer, dataStart + 16, dataEnd, false);
      if (!nested.valid || !nested.sawImage) return { valid: false, sawImage: false };
      sawImage = true;
    }

    offset = paddedEnd;
  }

  return { valid: offset === limit, sawImage };
}

function validWebp(buffer: Buffer): boolean {
  if (
    buffer.length < 20 ||
    ascii(buffer, 0, 4) !== "RIFF" ||
    ascii(buffer, 8, 12) !== "WEBP" ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  ) {
    return false;
  }
  const chunks = validWebpChunks(buffer, 12, buffer.length, true);
  return chunks.valid && chunks.sawImage;
}

/**
 * Detect a supported image only after bounded structural validation. This is
 * intentionally stricter than checking a magic prefix, while avoiding a native
 * image decoder in the production container.
 */
export function detectImageExtension(buffer: Buffer): ImageExtension | undefined {
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return undefined;
  try {
    if (validPng(buffer)) return ".png";
    if (validJpeg(buffer)) return ".jpg";
    if (validGif(buffer)) return ".gif";
    if (validWebp(buffer)) return ".webp";
  } catch {
    // Malformed structures are rejected rather than surfacing parser errors.
  }
  return undefined;
}

/** Verify that validated image bytes match their declared media type. */
export function matchesImageSignature(buffer: Buffer, mimeType: string): boolean {
  const expected = IMAGE_EXTENSION_BY_MIME[mimeType];
  return Boolean(expected && detectImageExtension(buffer) === expected);
}

function collectReferences(value: unknown, references: Set<string>, depth = 0): void {
  if (depth > 30) return;
  if (typeof value === "string") {
    try {
      const pathname = decodeURIComponent(new URL(value, "http://dashcenter.invalid").pathname);
      const match = GENERATED_IMAGE_URL.exec(pathname);
      if (match) references.add(match[1]);
    } catch {
      // Invalid URLs and malformed percent escapes cannot safely identify an upload.
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) collectReferences(nested, references, depth + 1);
}

export function referencedUploadNames(database: AppDatabase): Set<string> {
  const references = new Set<string>();
  collectReferences(readDashboard(database), references);

  const revisions = database.prepare("SELECT snapshot FROM revisions").all() as Array<{ snapshot: string }>;
  for (const revision of revisions) {
    try {
      collectReferences(JSON.parse(revision.snapshot), references);
    } catch {
      // A malformed historical snapshot cannot safely identify an upload.
    }
  }
  return references;
}

/**
 * Delete only server-generated, unreferenced image files after a grace period.
 * Unknown filenames, directories, symlinks, current data, and retained revision
 * snapshots are always left untouched.
 */
export async function pruneUnusedUploads(
  database: AppDatabase,
  uploadsDirectory: string,
  options: { now?: number; graceMs?: number } = {},
): Promise<number> {
  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? UNUSED_UPLOAD_GRACE_MS;
  const references = referencedUploadNames(database);
  const entries = await readdir(uploadsDirectory, { withFileTypes: true });
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !GENERATED_IMAGE_NAME.test(entry.name) || references.has(entry.name)) continue;
    const filename = path.join(uploadsDirectory, entry.name);
    const details = await lstat(filename).catch(() => undefined);
    if (!details?.isFile() || details.isSymbolicLink() || now - details.mtimeMs < graceMs) continue;
    try {
      await unlink(filename);
      removed += 1;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }

  return removed;
}

export function createUploadPruner(
  database: AppDatabase,
  uploadsDirectory: string,
  onError: (error: unknown) => void,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight: Promise<number> | undefined;

  const run = () => {
    if (!inFlight) {
      inFlight = pruneUnusedUploads(database, uploadsDirectory)
        .catch((error) => {
          onError(error);
          return 0;
        })
        .finally(() => {
          inFlight = undefined;
        });
    }
    return inFlight;
  };

  return {
    run,
    start() {
      if (timer) return;
      timer = setInterval(() => void run(), UPLOAD_PRUNE_INTERVAL_MS);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await inFlight;
    },
  };
}
