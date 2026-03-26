/**
 * CogProtocol — streaming tile renderer for Cloud Optimized GeoTIFFs.
 *
 * Registers a custom MapLibre GL protocol "cog://" that handles range-request
 * based tiled rendering of COG files.  Each tile request:
 *   cog://<encoded-url>/<z>/<x>/<y>
 * fetches only the relevant bytes from the remote (or object-URL) GeoTIFF,
 * renders the pixels to a canvas, and returns a PNG ArrayBuffer to MapLibre.
 *
 * Reprojection: tiles are requested in Web Mercator (EPSG:3857).  We read the
 * GeoTIFF's native CRS and, if it is not 4326/3857, we use proj4 to reproject
 * the tile bounding box back into the native CRS before calling readRasters().
 *
 * Colourmap: single-band rasters are rendered with a percentile-stretched
 * viridis colour ramp.  RGB/RGBA rasters are rendered directly.
 *
 * Usage:
 *   import { registerCogProtocol } from './CogProtocol.js';
 *   registerCogProtocol(maplibregl);   // call once before map creation
 *
 *   // Then add a source like:
 *   map.addSource('my-cog', {
 *     type: 'raster',
 *     tiles: ['cog://<encodeURIComponent(cogUrl)>/{z}/{x}/{y}'],
 *     tileSize: 256,
 *   });
 */

import * as GeoTIFF from 'geotiff';
import proj4 from 'proj4';
import { registerCRS } from '../utils/coordinates.js';

// ── Viridis colour ramp (10 stops) ─────────────────────────────────────────
const VIRIDIS = [
  [68,1,84],[72,40,120],[62,83,160],[49,123,186],[38,158,199],
  [31,188,210],[53,213,186],[109,228,149],[180,237,104],[253,231,37],
];

function viridis(t) {
  t = Math.max(0, Math.min(1, t));
  const idx = t * (VIRIDIS.length - 1);
  const lo = VIRIDIS[Math.floor(idx)];
  const hi = VIRIDIS[Math.min(VIRIDIS.length - 1, Math.ceil(idx))];
  const f = idx - Math.floor(idx);
  return [
    Math.round(lo[0] + f * (hi[0] - lo[0])),
    Math.round(lo[1] + f * (hi[1] - lo[1])),
    Math.round(lo[2] + f * (hi[2] - lo[2])),
  ];
}

// ── Tile maths (Web Mercator) ───────────────────────────────────────────────
const PI = Math.PI;

function tile2lng(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
function tile2lat(y, z) {
  const n = PI - (2 * PI * y) / Math.pow(2, z);
  return (180 / PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Returns [west, south, east, north] in EPSG:4326 for a tile. */
function tileBBox4326(z, x, y) {
  return [
    tile2lng(x, z),
    tile2lat(y + 1, z),
    tile2lng(x + 1, z),
    tile2lat(y, z),
  ];
}

// ── Per-URL tiff cache ──────────────────────────────────────────────────────
const tiffCache = new Map();      // url → { tiff, image, meta }
const statsCache = new Map();     // url → { min, max, noData, spp, crs, proj4def }

async function ensureCrsRegistered(epsg) {
  if (!epsg || epsg === 4326 || epsg === 3857) return;
  const key = `EPSG:${epsg}`;
  if (proj4.defs(key)) return;
  try {
    const res = await fetch(`https://epsg.io/${epsg}.proj4`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const def = await res.text();
    proj4.defs(key, def);
    registerCRS(key, def);
  } catch (e) {
    console.warn(`CogProtocol: could not register ${key}:`, e.message);
  }
}

async function getOrOpenTiff(url) {
  if (tiffCache.has(url)) return tiffCache.get(url);

  const tiff = await GeoTIFF.fromUrl(url, { allowFullFile: true });
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox();           // [xmin, ymin, xmax, ymax] in native CRS
  const geoKeys = image.getGeoKeys() || {};
  const spp = image.getSamplesPerPixel();

  const epsg = geoKeys.ProjectedCSTypeGeoKey
    || geoKeys.GeographicTypeGeoKey
    || 4326;

  await ensureCrsRegistered(epsg);

  // Build a quick stats estimate from the lowest-resolution overview
  const count = await tiff.getImageCount();
  const overview = await tiff.getImage(count > 1 ? count - 1 : 0);
  const ovW = Math.min(overview.getWidth(), 512);
  const ovH = Math.min(overview.getHeight(), 512);
  const ovData = await overview.readRasters({ interleave: true, width: ovW, height: ovH });

  let min = Infinity, max = -Infinity;
  const noData = image.getGDALNoData();
  const sampleStep = Math.max(1, Math.floor(ovData.length / (spp * 50000)));

  for (let i = 0; i < ovW * ovH; i += sampleStep) {
    const v = ovData[i * spp];   // sample first band only for stats
    if (v === noData || !isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }

  // Percentile clip: collect sorted sample to get p2/p98
  if (min < max) {
    const samples = [];
    for (let i = 0; i < ovW * ovH; i += sampleStep) {
      const v = ovData[i * spp];
      if (v !== noData && isFinite(v)) samples.push(v);
    }
    if (samples.length > 10) {
      samples.sort((a, b) => a - b);
      min = samples[Math.round(samples.length * 0.02)];
      max = samples[Math.round(samples.length * 0.98) - 1] ?? samples[samples.length - 1];
    }
  }

  const meta = { tiff, image, bbox, epsg, spp, min, max: max === min ? min + 1 : max, noData };
  tiffCache.set(url, meta);
  return meta;
}

// ── Tile renderer ───────────────────────────────────────────────────────────

async function renderTile(url, z, x, y, tileSize = 256) {
  const meta = await getOrOpenTiff(url);
  const { tiff, image, bbox, epsg, spp, min, max, noData } = meta;

  // Tile bounds in WGS84
  const [wLng, sLat, eLng, nLat] = tileBBox4326(z, x, y);

  // Convert tile bounds to the native CRS so we can call readRasters
  let [wx, sy, ex, ny] = [wLng, sLat, eLng, nLat];
  if (epsg !== 4326 && epsg !== 0) {
    try {
      const src = 'EPSG:4326';
      const dst = `EPSG:${epsg}`;
      [wx, sy] = proj4(src, dst, [wLng, sLat]);
      [ex, ny] = proj4(src, dst, [eLng, nLat]);
    } catch(e) {
      // If transform fails, tile will be blank — acceptable fallback
      return blankTile(tileSize);
    }
  }

  // Check overlap with image extent
  const [imgXmin, imgYmin, imgXmax, imgYmax] = bbox;
  if (ex < imgXmin || wx > imgXmax || ny < imgYmin || sy > imgYmax) {
    return blankTile(tileSize);
  }

  // Clamp to image extent
  const readXmin = Math.max(wx, imgXmin);
  const readYmin = Math.max(sy, imgYmin);
  const readXmax = Math.min(ex, imgXmax);
  const readYmax = Math.min(ny, imgYmax);

  // Pixel window within the full image
  const imgW = image.getWidth();
  const imgH = image.getHeight();
  const scaleX = imgW / (imgXmax - imgXmin);
  const scaleY = imgH / (imgYmax - imgYmin);

  const left   = Math.floor((readXmin - imgXmin) * scaleX);
  const top    = Math.floor((imgYmax - readYmax) * scaleY);
  const right  = Math.ceil ((readXmax - imgXmin) * scaleX);
  const bottom = Math.ceil ((imgYmax - readYmin) * scaleY);

  if (right <= left || bottom <= top) return blankTile(tileSize);

  let rasterData;
  try {
    rasterData = await image.readRasters({
      window: [left, top, right, bottom],
      width: tileSize,
      height: tileSize,
      interleave: true,
      fillValue: noData ?? 0,
    });
  } catch (e) {
    console.warn('CogProtocol readRasters error:', e.message);
    return blankTile(tileSize);
  }

  // Build ImageData
  const canvas = new OffscreenCanvas(tileSize, tileSize);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(tileSize, tileSize);
  const pxCount = tileSize * tileSize;
  const range = max - min || 1;

  if (spp >= 3) {
    // RGB / RGBA
    let idx = 0;
    for (let i = 0; i < pxCount; i++) {
      imgData.data[idx++] = rasterData[i * spp];
      imgData.data[idx++] = rasterData[i * spp + 1];
      imgData.data[idx++] = rasterData[i * spp + 2];
      imgData.data[idx++] = spp >= 4 ? rasterData[i * spp + 3] : 255;
    }
  } else {
    // Single band — viridis ramp
    let idx = 0;
    for (let i = 0; i < pxCount; i++) {
      const v = rasterData[i];
      if (noData !== null && noData !== undefined && v === noData) {
        imgData.data[idx++] = 0;
        imgData.data[idx++] = 0;
        imgData.data[idx++] = 0;
        imgData.data[idx++] = 0;
      } else {
        const [r, g, b] = viridis((v - min) / range);
        imgData.data[idx++] = r;
        imgData.data[idx++] = g;
        imgData.data[idx++] = b;
        imgData.data[idx++] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Only paint the portion of the tile that actually overlaps the image
  // (the rest should remain transparent)
  if (wx < imgXmin || eLng > imgXmax || sLat < imgYmin || nLat > imgYmax) {
    const outCanvas = new OffscreenCanvas(tileSize, tileSize);
    const outCtx = outCanvas.getContext('2d');

    // Compute where within the tile the valid pixels go
    const tileW = eLng - wLng;
    const tileH = nLat - sLat;
    const dstX = Math.round(((readXmin - wx) / tileW) * tileSize);
    const dstY = Math.round(((nLat - readYmax) / tileH) * tileSize);
    const dstW = Math.round(((readXmax - readXmin) / tileW) * tileSize);
    const dstH = Math.round(((readYmax - readYmin) / tileH) * tileSize);

    if (dstW > 0 && dstH > 0) {
      outCtx.drawImage(canvas, 0, 0, tileSize, tileSize, dstX, dstY, dstW, dstH);
    }
    return outCanvas.convertToBlob({ type: 'image/png' });
  }

  return canvas.convertToBlob({ type: 'image/png' });
}

function blankTile(size) {
  const c = new OffscreenCanvas(size, size);
  return c.convertToBlob({ type: 'image/png' });
}

// ── Protocol registration ───────────────────────────────────────────────────

let _registered = false;

/**
 * Register the "cog://" protocol with a maplibre-gl instance.
 * Call this once, before creating any maps.
 *
 * @param {object} maplibregl - the maplibre-gl module
 */
export function registerCogProtocol(maplibregl) {
  if (_registered) return;
  _registered = true;

  maplibregl.addProtocol('cog', async (params, abortController) => {
    // params.url looks like: "cog://<encodedUrl>/<z>/<x>/<y>"
    const raw = params.url;                        // e.g. cog://https%3A...tif/12/3456/789
    const withoutProto = raw.slice('cog://'.length);  // <encodedUrl>/<z>/<x>/<y>

    // The URL may itself contain slashes, so split from the right for z/x/y
    const parts = withoutProto.split('/');
    const y = parseInt(parts.pop(), 10);
    const x = parseInt(parts.pop(), 10);
    const z = parseInt(parts.pop(), 10);
    const encodedUrl = parts.join('/');
    const cogUrl = decodeURIComponent(encodedUrl);

    try {
      const blob = await renderTile(cogUrl, z, x, y, 256);
      const buffer = await blob.arrayBuffer();
      return { data: buffer };
    } catch (e) {
      console.warn('CogProtocol tile error:', e.message, { z, x, y, cogUrl });
      // Return blank tile on error so MapLibre doesn't stall
      const blank = await blankTile(256);
      const buffer = await blank.arrayBuffer();
      return { data: buffer };
    }
  });
}

/**
 * Build a MapLibre tile URL template for a given COG URL.
 * @param {string} cogUrl
 * @returns {string}
 */
export function cogTileUrl(cogUrl) {
  return `cog://${encodeURIComponent(cogUrl)}/{z}/{x}/{y}`;
}

/**
 * Pre-warm the tiff cache and return metadata (bbox in WGS84, crs, band count).
 * @param {string} cogUrl
 * @returns {Promise<{bbox: number[], epsg: number, spp: number, min: number, max: number}>}
 */
export async function probeCog(cogUrl) {
  const meta = await getOrOpenTiff(cogUrl);
  const { bbox, epsg, spp, min, max } = meta;

  // Convert bbox to WGS84 if needed
  let [xmin, ymin, xmax, ymax] = bbox;
  if (epsg !== 4326 && epsg !== 0) {
    try {
      const src = `EPSG:${epsg}`;
      [xmin, ymin] = proj4(src, 'EPSG:4326', [xmin, ymin]);
      [xmax, ymax] = proj4(src, 'EPSG:4326', [xmax, ymax]);
    } catch(e) {}
  }
  return { bbox: [xmin, ymin, xmax, ymax], epsg, spp, min, max };
}

/**
 * Clear the tiff + stats caches (useful when removing layers).
 * @param {string} [cogUrl] - if omitted, clears all
 */
export function clearCogCache(cogUrl) {
  if (cogUrl) {
    tiffCache.delete(cogUrl);
    statsCache.delete(cogUrl);
  } else {
    tiffCache.clear();
    statsCache.clear();
  }
}
