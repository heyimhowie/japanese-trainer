#!/usr/bin/env node
// Generates PWA icons as simple PNG files (no external dependencies)
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const BG = [15, 15, 26];        // #0f0f1a
const ACCENT = [108, 99, 255];   // #6c63ff
const WHITE = [224, 224, 224];   // #e0e0e0

function createIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const m = Math.floor(size * 0.15);  // outer margin
  const b = Math.floor(size * 0.09);  // stroke width
  const midY = Math.floor(size * 0.48);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const inBox = x >= m && x < size - m && y >= m && y < size - m;
      const isVBorder = x < m + b || x >= size - m - b;
      const isHBorder = y < m + b || y >= size - m - b;
      const isMidBar = Math.abs(y - midY) < Math.floor(b * 0.6);

      let color = BG;
      if (inBox && (isVBorder || isHBorder || isMidBar)) {
        color = ACCENT;
      }
      raw[px]     = color[0];
      raw[px + 1] = color[1];
      raw[px + 2] = color[2];
      raw[px + 3] = 255;
    }
  }
  return encodePNG(raw, size, size);
}

function encodePNG(rawData, width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const compressed = zlib.deflateSync(rawData);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcVal = crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate icons
const outDir = path.join(__dirname, '..', 'public', 'images');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512, 180]) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  const png = createIcon(size);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`Generated ${name} (${size}x${size})`);
}
