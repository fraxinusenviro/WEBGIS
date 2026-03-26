import shp, { parseShp, parseDbf, combine } from 'shpjs';
import { bus, EVENTS } from '../utils/EventBus.js';
import { detectCRS, reprojectGeoJSON, transformCoord } from '../utils/coordinates.js';
import { layerManager } from '../layers/LayerManager.js';
import { uid } from '../utils/uid.js';
import { probeCog, cogTileUrl } from './CogProtocol.js';

/**
 * ImportManager — handles file-based and service-based data ingestion
 */
export class ImportManager {
  constructor() {}

  /**
   * Main entry: accept File objects or an array thereof.
   * Groups .shp files with their sibling component files (.dbf, .shx, .prj)
   * when multiple files are selected together.
   */
  async importFiles(files) {
    const fileArr = Array.from(files);

    // Identify .shp files and match with sibling components by base name
    const shpFiles = fileArr.filter(f => f.name.toLowerCase().endsWith('.shp'));
    const processedNames = new Set();

    for (const shpFile of shpFiles) {
      const base = shpFile.name.replace(/\.shp$/i, '').toLowerCase();
      const bundle = { shp: shpFile, dbf: null, shx: null, prj: null };
      for (const f of fileArr) {
        const n = f.name.toLowerCase();
        if (n === base + '.dbf') bundle.dbf = f;
        else if (n === base + '.shx') bundle.shx = f;
        else if (n === base + '.prj') bundle.prj = f;
      }
      processedNames.add(shpFile.name.toLowerCase());
      if (bundle.dbf) processedNames.add(bundle.dbf.name.toLowerCase());
      if (bundle.shx) processedNames.add(bundle.shx.name.toLowerCase());
      if (bundle.prj) processedNames.add(bundle.prj.name.toLowerCase());

      try {
        await this._importShapefileBundle(bundle);
      } catch(e) {
        console.error('Import error:', e);
        bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Failed to import ${shpFile.name}: ${e.message}` });
      }
    }

    // Process remaining files that weren't part of a .shp bundle
    for (const file of fileArr) {
      if (processedNames.has(file.name.toLowerCase())) continue;
      try {
        await this.importFile(file);
      } catch(e) {
        console.error('Import error:', e);
        bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Failed to import ${file.name}: ${e.message}` });
      }
    }
  }

  async importFile(file) {
    const name = file.name;
    const ext = name.split('.').pop().toLowerCase();
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: `Importing ${name}…` });

    switch(ext) {
      case 'geojson':
      case 'json':
        return this._importGeoJSON(file);
      case 'kml':
        return this._importKML(file);
      case 'gpx':
        return this._importGPX(file);
      case 'csv':
        return this._importCSV(file);
      case 'zip':
        return this._importShapefileZip(file);
      case 'shp':
        // Single .shp without siblings — attempt with just the shp file, warn if dbf missing
        return this._importShapefileBundle({ shp: file, dbf: null, shx: null, prj: null });
      case 'tif':
      case 'tiff':
        return this._importGeoTIFF(file);
      case 'mbtiles':
        return this._importMBTiles(file);
      case 'pdf':
        return this._importGeoPDF(file);
      default:
        bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: `Unsupported format: .${ext}` });
    }
  }

  // ---- GeoJSON ----
  async _importGeoJSON(file) {
    const text = await file.text();
    let geojson;
    try { geojson = JSON.parse(text); } catch(e) {
      throw new Error('Invalid JSON');
    }

    // Normalize to FeatureCollection
    if (geojson.type === 'Feature') {
      geojson = { type: 'FeatureCollection', features: [geojson] };
    } else if (geojson.type !== 'FeatureCollection') {
      // Might be a raw geometry
      geojson = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geojson, properties: {} }] };
    }

    // Reproject if needed
    const crs = detectCRS(geojson);
    if (crs && crs !== 'EPSG:4326') {
      geojson = reprojectGeoJSON(geojson, crs);
    }

    await layerManager.addLayer({
      name: file.name.replace(/\.[^.]+$/, ''),
      type: 'vector',
      data: geojson,
      sourceFormat: 'geojson',
    });
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${file.name} (${geojson.features.length} features)` });
  }

  // ---- KML ----
  async _importKML(file) {
    const text = await file.text();
    const parser = new DOMParser();
    const kmlDoc = parser.parseFromString(text, 'application/xml');
    const geojson = kmlToGeoJSON(kmlDoc);
    await layerManager.addLayer({
      name: file.name.replace(/\.[^.]+$/, ''),
      type: 'vector',
      data: geojson,
      sourceFormat: 'kml',
    });
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${file.name}` });
  }

  // ---- GPX ----
  async _importGPX(file) {
    const text = await file.text();
    const parser = new DOMParser();
    const gpxDoc = parser.parseFromString(text, 'application/xml');
    const geojson = gpxToGeoJSON(gpxDoc);
    await layerManager.addLayer({
      name: file.name.replace(/\.[^.]+$/, ''),
      type: 'vector',
      data: geojson,
      sourceFormat: 'gpx',
    });
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${file.name}` });
  }

  // ---- CSV ----
  async _importCSV(file) {
    const text = await file.text();
    const geojson = parseCSVtoGeoJSON(text, file.name);
    if (!geojson) {
      throw new Error('CSV must contain latitude/longitude columns');
    }
    await layerManager.addLayer({
      name: file.name.replace(/\.[^.]+$/, ''),
      type: 'vector',
      data: geojson,
      sourceFormat: 'csv',
    });
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${file.name} (${geojson.features.length} rows)` });
  }

  // ---- Shapefile ZIP ----
  async _importShapefileZip(file) {
    const buffer = await file.arrayBuffer();
    let geojson;
    try {
      geojson = await shp(buffer);
    } catch(e) {
      // Try as plain shapefile
      throw new Error('Could not parse shapefile: ' + e.message);
    }

    // shpjs returns FeatureCollection or array
    const layers = Array.isArray(geojson) ? geojson : [geojson];
    const baseName = file.name.replace(/\.[^.]+$/, '');

    for (let i = 0; i < layers.length; i++) {
      const fc = layers[i];
      const crs = detectCRS(fc);
      const projected = (crs && crs !== 'EPSG:4326') ? reprojectGeoJSON(fc, crs) : fc;
      await layerManager.addLayer({
        name: layers.length > 1 ? `${baseName}_${i + 1}` : baseName,
        type: 'vector',
        data: projected,
        sourceFormat: 'shapefile',
      });
    }
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${file.name}` });
  }

  // ---- Shapefile component bundle (.shp + .dbf + optionally .shx/.prj) ----
  async _importShapefileBundle(bundle) {
    const { shp: shpFile, dbf: dbfFile } = bundle;
    const baseName = shpFile.name.replace(/\.[^.]+$/, '');
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: `Importing ${shpFile.name}…` });

    if (!dbfFile) {
      bus.emit(EVENTS.SHOW_TOAST, {
        type: 'warning',
        message: `No .dbf found for ${shpFile.name} — attributes will be missing. Select .shp, .dbf, .shx, .prj together for full import.`,
        duration: 6000,
      });
    }

    const shpBuffer = await shpFile.arrayBuffer();
    const dbfBuffer = dbfFile ? await dbfFile.arrayBuffer() : null;

    let geojson;
    try {
      if (dbfBuffer) {
        geojson = combine([parseShp(shpBuffer), parseDbf(dbfBuffer)]);
      } else {
        // combine() requires a [geoms, props] tuple — build FeatureCollection manually without dbf
        const geoms = parseShp(shpBuffer);
        geojson = {
          type: 'FeatureCollection',
          features: geoms.map(g => ({ type: 'Feature', geometry: g, properties: {} })),
        };
      }
    } catch(e) {
      throw new Error('Could not parse shapefile components: ' + e.message);
    }

    const layers = Array.isArray(geojson) ? geojson : [geojson];
    for (let i = 0; i < layers.length; i++) {
      const fc = layers[i];
      const crs = detectCRS(fc);
      const projected = (crs && crs !== 'EPSG:4326') ? reprojectGeoJSON(fc, crs) : fc;
      await layerManager.addLayer({
        name: layers.length > 1 ? `${baseName}_${i + 1}` : baseName,
        type: 'vector',
        data: projected,
        sourceFormat: 'shapefile',
      });
    }
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${shpFile.name}` });
  }

  // ---- GeoTIFF / COG ----
  async _importGeoTIFF(file) {
    // Create a persistent object URL so the CogProtocol can make range requests
    // against the in-memory file (the URL is kept alive for the session).
    const objectUrl = URL.createObjectURL(file);

    try {
      // probeCog reads just the IFD/overview via range requests — no full load
      const { bbox: [xmin, ymin, xmax, ymax], epsg, spp } = await probeCog(objectUrl);

      await layerManager.addLayer({
        name: file.name.replace(/\.[^.]+$/, ''),
        type: 'cog',
        url: objectUrl,
        tileUrl: cogTileUrl(objectUrl),
        bbox: [[xmin, ymin], [xmax, ymax]],
        opacity: 1.0,
        sourceFormat: 'geotiff',
        metadata: { epsg, spp, localFile: true, fileName: file.name },
      });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${file.name}` });
    } catch(e) {
      // If the COG protocol fails (e.g. non-COG GeoTIFF without overviews),
      // fall back to the simple full-read canvas approach.
      URL.revokeObjectURL(objectUrl);
      console.warn('CogProtocol import failed, falling back to canvas render:', e.message);
      await this._importGeoTIFFFallback(file);
    }
  }

  // Fallback: render the entire GeoTIFF to a canvas image (for small / non-COG files)
  async _importGeoTIFFFallback(file) {
    const GeoTIFF = await import('geotiff');
    const arrayBuffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();

    const bbox = image.getBoundingBox();
    const [minX, minY, maxX, maxY] = bbox;

    const canvas = await renderGeoTIFFToCanvas(image);
    const dataUrl = canvas.toDataURL('image/png');

    const geoKeys = image.getGeoKeys();
    let crs = 'EPSG:4326';
    if (geoKeys?.ProjectedCSTypeGeoKey) {
      crs = `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;
    } else if (geoKeys?.GeographicTypeGeoKey) {
      crs = `EPSG:${geoKeys.GeographicTypeGeoKey}`;
    }

    let finalBbox = [[minX, minY], [maxX, maxY]];
    if (crs !== 'EPSG:4326') {
      try {
        const sw = transformCoord([minX, minY], crs, 'EPSG:4326');
        const ne = transformCoord([maxX, maxY], crs, 'EPSG:4326');
        finalBbox = [sw, ne];
      } catch(e) {
        console.warn('CRS transform failed for GeoTIFF fallback, using raw bbox');
      }
    }

    await layerManager.addLayer({
      name: file.name.replace(/\.[^.]+$/, ''),
      type: 'image',
      imageUrl: dataUrl,
      bbox: finalBbox,
      opacity: 1.0,
      sourceFormat: 'geotiff',
    });
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported ${file.name} (static render)` });
  }

  // ---- MBTiles ----
  async _importMBTiles(file) {
    // Use sql.js to read SQLite
    const arrayBuffer = await file.arrayBuffer();
    try {
      const SQL = await initSqlJs();
      const db = new SQL.Database(new Uint8Array(arrayBuffer));

      // Read metadata
      const meta = {};
      try {
        const res = db.exec('SELECT name, value FROM metadata');
        if (res[0]) {
          res[0].values.forEach(([k, v]) => { meta[k] = v; });
        }
      } catch(e) {}

      const format = meta.format || 'png';
      const layerName = meta.name || file.name.replace(/\.[^.]+$/, '');
      let bbox = null;
      if (meta.bounds) {
        const [w, s, e, n] = meta.bounds.split(',').map(Number);
        bbox = [[w, s], [e, n]];
      }

      // Create tile fetch function using the in-memory DB
      const tileCache = new Map();

      await layerManager.addLayer({
        name: layerName,
        type: 'mbtiles',
        bbox,
        opacity: 1.0,
        sourceFormat: 'mbtiles',
        metadata: meta,
        _sqlDb: db,
        _tileFormat: format,
        _tileCache: tileCache,
        // The tileFunction will be used by a custom protocol handler
        tileFunction: async (z, x, y) => {
          const key = `${z}/${x}/${y}`;
          if (tileCache.has(key)) return tileCache.get(key);
          const flippedY = Math.pow(2, z) - 1 - y;
          const res = db.exec(`SELECT tile_data FROM tiles WHERE zoom_level=${z} AND tile_column=${x} AND tile_row=${flippedY}`);
          if (!res[0]?.values[0]) return null;
          const data = res[0].values[0][0];
          const blob = new Blob([data], { type: `image/${format}` });
          const url = URL.createObjectURL(blob);
          tileCache.set(key, url);
          return url;
        },
      });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Imported MBTiles: ${layerName}` });
    } catch(e) {
      throw new Error('Failed to read MBTiles: ' + e.message);
    }
  }

  // ---- GeoPDF ----
  async _importGeoPDF(file) {
    // Use PDF.js from CDN to render first page as image
    try {
      // Load PDF.js dynamically from CDN
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs';
          script.type = 'module';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        // Give it a moment to initialize
        await new Promise(r => setTimeout(r, 500));
      }

      const pdfjsLib = window.pdfjsLib || (await import(/* @vite-ignore */ 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs'));
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs';
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement('canvas');
      canvas.width = Math.min(viewport.width, 4096);
      canvas.height = Math.min(viewport.height, 4096);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const dataUrl = canvas.toDataURL('image/png');

      bus.emit(EVENTS.SHOW_TOAST, {
        type: 'warning',
        message: 'GeoPDF imported as image overlay. Drag corners to georeference if needed.',
        duration: 6000,
      });

      await layerManager.addLayer({
        name: file.name.replace(/\.[^.]+$/, ''),
        type: 'image',
        imageUrl: dataUrl,
        bbox: [[-180, -85.051129], [180, 85.051129]],
        opacity: 0.8,
        sourceFormat: 'geopdf',
      });
    } catch(e) {
      throw new Error('Failed to render PDF: ' + e.message);
    }
  }
}

// ---- Helper: Initialize sql.js ----
async function initSqlJs() {
  const initSqlJs = (await import('sql.js')).default;
  return initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/${file}` });
}

// ---- Helper: Render GeoTIFF image to canvas ----
async function renderGeoTIFFToCanvas(image) {
  const width = image.getWidth();
  const height = image.getHeight();
  const data = await image.readRasters({ interleave: true });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);

  const samplesPerPixel = image.getSamplesPerPixel();
  let idx = 0;

  if (samplesPerPixel >= 3) {
    // RGB or RGBA
    for (let i = 0; i < width * height; i++) {
      imageData.data[idx++] = data[i * samplesPerPixel];         // R
      imageData.data[idx++] = data[i * samplesPerPixel + 1];     // G
      imageData.data[idx++] = data[i * samplesPerPixel + 2];     // B
      imageData.data[idx++] = samplesPerPixel >= 4 ? data[i * samplesPerPixel + 3] : 255;
    }
  } else {
    // Single band / grayscale
    const min = Math.min(...Array.from(data).slice(0, Math.min(1000, data.length)));
    const max = Math.max(...Array.from(data).slice(0, Math.min(1000, data.length)));
    const range = max - min || 1;
    for (let i = 0; i < width * height; i++) {
      const v = Math.round(((data[i] - min) / range) * 255);
      imageData.data[idx++] = v;
      imageData.data[idx++] = v;
      imageData.data[idx++] = v;
      imageData.data[idx++] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// ---- Helper: Parse CSV to GeoJSON ----
function parseCSVtoGeoJSON(text, filename) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  // Parse header
  const header = parseCSVLine(lines[0]);
  const lngCols = ['longitude', 'lng', 'lon', 'x', 'long'];
  const latCols = ['latitude', 'lat', 'y'];

  const lngIdx = header.findIndex(h => lngCols.includes(h.toLowerCase().trim()));
  const latIdx = header.findIndex(h => latCols.includes(h.toLowerCase().trim()));

  if (lngIdx < 0 || latIdx < 0) return null;

  const features = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCSVLine(lines[i]);
    const lng = parseFloat(vals[lngIdx]);
    const lat = parseFloat(vals[latIdx]);
    if (isNaN(lng) || isNaN(lat)) continue;

    const props = {};
    header.forEach((h, j) => { if (j !== lngIdx && j !== latIdx) props[h.trim()] = vals[j]; });

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: props,
    });
  }

  return { type: 'FeatureCollection', features };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// ---- Helper: KML to GeoJSON ----
function kmlToGeoJSON(doc) {
  const features = [];
  const placemarks = doc.querySelectorAll('Placemark');

  placemarks.forEach(pm => {
    const name = pm.querySelector('name')?.textContent || '';
    const desc = pm.querySelector('description')?.textContent || '';
    const props = { name, description: desc };

    // Extended data
    pm.querySelectorAll('Data, SimpleData').forEach(d => {
      const key = d.getAttribute('name') || d.tagName;
      props[key] = d.querySelector('value')?.textContent || d.textContent;
    });

    const geom = parseKMLGeometry(pm);
    if (geom) features.push({ type: 'Feature', geometry: geom, properties: props });
  });

  return { type: 'FeatureCollection', features };
}

function parseKMLGeometry(el) {
  const pointEl = el.querySelector('Point coordinates');
  if (pointEl) {
    const parts = pointEl.textContent.trim().split(',');
    return { type: 'Point', coordinates: [parseFloat(parts[0]), parseFloat(parts[1])] };
  }
  const lineEl = el.querySelector('LineString coordinates');
  if (lineEl) {
    const coords = parseKMLCoords(lineEl.textContent);
    return { type: 'LineString', coordinates: coords };
  }
  const polyEl = el.querySelector('Polygon outerBoundaryIs LinearRing coordinates');
  if (polyEl) {
    const coords = parseKMLCoords(polyEl.textContent);
    return { type: 'Polygon', coordinates: [coords] };
  }
  return null;
}

function parseKMLCoords(text) {
  return text.trim().split(/\s+/).map(c => {
    const parts = c.split(',');
    return [parseFloat(parts[0]), parseFloat(parts[1])];
  }).filter(c => !isNaN(c[0]));
}

// ---- Helper: GPX to GeoJSON ----
function gpxToGeoJSON(doc) {
  const features = [];
  // Waypoints
  doc.querySelectorAll('wpt').forEach(wpt => {
    const lat = parseFloat(wpt.getAttribute('lat'));
    const lon = parseFloat(wpt.getAttribute('lon'));
    const name = wpt.querySelector('name')?.textContent || '';
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { name },
    });
  });
  // Tracks
  doc.querySelectorAll('trk').forEach(trk => {
    const name = trk.querySelector('name')?.textContent || 'Track';
    const segments = trk.querySelectorAll('trkseg');
    segments.forEach(seg => {
      const coords = [];
      seg.querySelectorAll('trkpt').forEach(pt => {
        coords.push([parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat'))]);
      });
      if (coords.length > 1) {
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: coords },
          properties: { name },
        });
      }
    });
  });
  // Routes
  doc.querySelectorAll('rte').forEach(rte => {
    const name = rte.querySelector('name')?.textContent || 'Route';
    const coords = [];
    rte.querySelectorAll('rtept').forEach(pt => {
      coords.push([parseFloat(pt.getAttribute('lon')), parseFloat(pt.getAttribute('lat'))]);
    });
    if (coords.length > 1) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { name },
      });
    }
  });
  return { type: 'FeatureCollection', features };
}

export const importManager = new ImportManager();
