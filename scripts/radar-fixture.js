import {deflateSync} from 'node:zlib';
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data));
  return Buffer.concat([length, data, crc]);
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p-a), pb = Math.abs(p-b), pc = Math.abs(p-c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
export function radarFixture({ filter = 0, channels = 4, pixels = [], width = 256, height = 256, rawOverride } = {}) {
  const rgba = new Uint8Array(256 * 256 * channels);
  for (const [x, y, color = [0, 150, 255, 255]] of pixels) rgba.set(color.slice(0, channels), (y * 256 + x) * channels);
  const stride = 256 * channels;
  const raw = Buffer.alloc(256 * (stride + 1));
  for (let y = 0; y < 256; y++) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const index = y * stride + i;
      const a = i >= channels ? rgba[index - channels] : 0;
      const b = y ? rgba[index - stride] : 0;
      const c = y && i >= channels ? rgba[index - stride - channels] : 0;
      const p = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a+b)/2) : paeth(a,b,c);
      raw[y * (stride + 1) + 1 + i] = (rgba[index] - p) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = channels === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rawOverride || raw)), chunk('IEND', Buffer.alloc(0))]);
}
