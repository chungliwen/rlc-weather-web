// Historical RainViewer observations only. This is not a forecast/nowcast.
export const RADAR_LOCATION = Object.freeze({ latitude: 3.1469, longitude: 101.6834 });
const ZOOM = 7;
const RADIUS_KM = 20;
const TILE_SIZE = 256;
const MAX_PNG_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8000;
const radians = (v) => v * Math.PI / 180;
export function distanceKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, a)));
}
export function tilePosition(lat, lon, zoom) {
  const scale = 2 ** zoom;
  const x = (lon + 180) / 360 * scale;
  const latRad = radians(lat);
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale;
  return { tile_x: Math.floor(x), tile_y: Math.floor(y), pixel_x: (x - Math.floor(x)) * 256, pixel_y: (y - Math.floor(y)) * 256 };
}
export const kmPerPixel = (lat, zoom) => Math.cos(radians(lat)) * 156.54303392 / 2 ** zoom;
export const compassDirection = (dx, dy) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360 + 22.5) / 45) % 8];

async function boundedRead(stream, limit) {
  if (!stream) throw new Error('Missing response body');
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Body exceeds limit');
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Deliberately narrow: 256x256, non-interlaced 8-bit RGB/RGBA only.
// Unknown formats fail closed rather than interpreting palette indices as rain.
export async function decodeRadarPng(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PNG_BYTES || bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) throw new Error('Invalid PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, channels = 0, ended = false, idatEnded = false, seenIdat = false;
  const compressed = [];
  let compressedLength = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Truncated PNG chunk');
    const length = view.getUint32(offset);
    const end = offset + 8 + length;
    if (end + 4 > bytes.length || length > MAX_PNG_BYTES) throw new Error('Invalid PNG chunk length');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (crc32(bytes, offset + 4, end) !== view.getUint32(end)) throw new Error('PNG CRC mismatch');
    const data = offset + 8;
    if (!channels && type !== 'IHDR') throw new Error('Missing PNG header');
    if (seenIdat && type !== 'IDAT') idatEnded = true;
    if (type === 'IHDR') {
      if (channels || offset !== 8 || length !== 13 || view.getUint32(data) !== TILE_SIZE || view.getUint32(data + 4) !== TILE_SIZE || bytes[data + 8] !== 8 || ![2, 6].includes(bytes[data + 9]) || bytes[data + 10] !== 0 || bytes[data + 11] !== 0 || bytes[data + 12] !== 0) throw new Error('Unsupported PNG header');
      channels = bytes[data + 9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      if (idatEnded) throw new Error('Noncontiguous PNG data');
      seenIdat = true;
      compressed.push(bytes.subarray(data, end));
      compressedLength += length;
    } else if (type === 'IEND') {
      if (length || !seenIdat || end + 4 !== bytes.length) throw new Error('Invalid PNG end');
      ended = true;
      break;
    } else if (type === 'tRNS' || type === 'acTL' || (type !== 'PLTE' && !(bytes[offset + 4] & 32))) {
      throw new Error('Unsupported PNG chunk');
    }
    offset = end + 4;
  }
  if (!ended || !compressedLength) throw new Error('Incomplete PNG');
  const packed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const chunk of compressed) { packed.set(chunk, cursor); cursor += chunk.length; }
  const stride = TILE_SIZE * channels;
  const expected = (stride + 1) * TILE_SIZE;
  const raw = await boundedRead(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate')), expected);
  if (raw.length !== expected) throw new Error('Invalid PNG scanline length');
  const rgba = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
  let prior = new Uint8Array(stride);
  cursor = 0;
  for (let y = 0; y < TILE_SIZE; y++) {
    const filter = raw[cursor++];
    if (filter > 4) throw new Error('Unsupported PNG filter');
    const row = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prior[i], c = i >= channels ? prior[i - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? Math.floor((a + b) / 2) : paeth(a, b, c);
      row[i] = (row[i] + predictor) & 255;
    }
    for (let x = 0; x < TILE_SIZE; x++) {
      const target = (y * TILE_SIZE + x) * 4, source = x * channels;
      rgba[target] = row[source]; rgba[target + 1] = row[source + 1]; rgba[target + 2] = row[source + 2]; rgba[target + 3] = channels === 4 ? row[source + 3] : 255;
    }
    prior = row;
  }
  return { width: TILE_SIZE, height: TILE_SIZE, rgba };
}

export function analyzeImage(image, position, time) {
  const scale = kmPerPixel(RADAR_LOCATION.latitude, ZOOM);
  const radius = RADIUS_KM / scale;
  const cx = position.pixel_x, cy = position.pixel_y;
  if (image.width !== 256 || image.height !== 256 || cx - radius < 0 || cx + radius > 255 || cy - radius < 0 || cy + radius > 255) throw new Error('Radar search radius clips tile');
  let nearest = null, direction = null;
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      if (x < 0 || x >= 256 || y < 0 || y >= 256) continue;
      const offset = (y * 256 + x) * 4;
      if (image.rgba[offset + 3] <= 20 || image.rgba[offset] + image.rgba[offset + 1] + image.rgba[offset + 2] <= 10) continue;
      const dx = x - cx, dy = y - cy, distance = Math.hypot(dx, dy) * scale;
      if (distance <= RADIUS_KM && (nearest === null || distance < nearest)) { nearest = distance; direction = compassDirection(dx, dy); }
    }
  }
  return { time, nearest_km: nearest, direction };
}
const round = (v) => v === null ? null : Math.round(v * 10) / 10;
export function summarizeRadar(observations, generatedAt) {
  const latest = observations.at(-1);
  const distances = observations.map((item) => item.nearest_km);
  const usable = distances.slice(-4).filter((d) => d !== null);
  const approaching = usable.length >= 3 && usable[0] - usable.at(-1) >= 3;
  return {
    available: true,
    status: latest.nearest_km === null ? 'dry' : latest.nearest_km <= 2 ? 'overhead' : approaching ? 'approaching' : 'nearby',
    nearest_km: round(latest.nearest_km), direction: latest.direction,
    observed_at: new Date(latest.time * 1000).toISOString(), generated_at: new Date(generatedAt * 1000).toISOString(),
    frames_analyzed: observations.length, distances_km: distances.map(round),
    historical_only: true, radius_km: RADIUS_KM,
  };
}
const unavailable = (reason) => ({ available: false, status: 'unavailable', reason, historical_only: true });
async function fetchFrame(url, frame, position, fetcher) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { headers: { Accept: 'image/png' }, redirect: 'error', signal: controller.signal });
        if (!response.ok) throw new Error('Radar HTTP failure');
        const declared = Number(response.headers.get('content-length'));
        if (declared > MAX_PNG_BYTES) throw new Error('Radar tile too large');
        const bytes = await boundedRead(response.body, MAX_PNG_BYTES);
        return analyzeImage(await decodeRadarPng(bytes), position, frame.time);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Radar timeout')); }, TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}
export async function analyzeRadar(metadata, now, fetcher = fetch) {
  try {
    const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
    if (!Number.isFinite(nowMs)) return unavailable('Invalid radar analysis time');
    const nowSec = nowMs / 1000;
    if (!metadata || !Number.isSafeInteger(metadata.generated) || metadata.generated > nowSec || nowSec - metadata.generated > 1800) return unavailable('Radar metadata is stale or invalid');
    if (metadata.host !== 'https://tilecache.rainviewer.com') return unavailable('Unapproved radar tile host');
    const past = metadata.radar?.past;
    if (!Array.isArray(past) || !past.length || past.length > 100) return unavailable('RainViewer returned no valid radar frames');
    // RainViewer may use opaque hexadecimal frame IDs rather than epoch IDs.
    // Time validity comes from frame.time; paths remain confined to this host/prefix.
    if (past.some((frame) => !frame || !Number.isSafeInteger(frame.time) || frame.time <= 0 || frame.time > nowSec || !(frame.path === `/v2/radar/${frame.time}` || /^\/v2\/radar\/[a-f0-9]{12,64}$/.test(frame.path)))) return unavailable('Invalid historical radar frame');
    const selected = [...new Map(past.map((frame) => [frame.time, frame])).values()].sort((a, b) => a.time - b.time).slice(-6);
    if (nowSec - selected.at(-1).time > 1800) return unavailable('Latest radar frame is stale');
    const position = tilePosition(RADAR_LOCATION.latitude, RADAR_LOCATION.longitude, ZOOM);
    const results = await Promise.all(selected.map(async (frame) => {
      try { return await fetchFrame(`${metadata.host}${frame.path}/256/${ZOOM}/${position.tile_x}/${position.tile_y}/2/0_0.png`, frame, position, fetcher); }
      catch { return null; }
    }));
    if (!results.at(-1)) return unavailable('Latest radar tile could not be fetched or decoded');
    const summary = summarizeRadar(results.filter(Boolean), metadata.generated);
    summary.frames_requested = selected.length;
    summary.partial_history = results.some((result) => result === null);
    return summary;
  } catch { return unavailable('Radar analysis failed'); }
}
