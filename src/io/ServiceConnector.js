import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { reprojectGeoJSON, transformCoord } from '../utils/coordinates.js';

/**
 * ServiceConnector — handles connection to web map services
 * Supported: WMS, WMTS, XYZ, ESRI REST (Feature/Map/Image), COG
 */
export class ServiceConnector {

  /**
   * Add a WMS layer
   */
  async addWMS(url, params = {}) {
    const { layers, name } = params;
    await layerManager.addLayer({
      name: name || layers || 'WMS Layer',
      type: 'wms',
      url: cleanUrl(url),
      serviceParams: {
        layers: layers || '',
        styles: params.styles || '',
        format: params.format || 'image/png',
        version: params.version || '1.3.0',
        attribution: params.attribution || url,
        ...params,
      },
      sourceFormat: 'wms',
    });
  }

  /**
   * Add a WMTS layer
   */
  async addWMTS(url, params = {}) {
    await layerManager.addLayer({
      name: params.name || 'WMTS Layer',
      type: 'wmts',
      url: cleanUrl(url),
      serviceParams: {
        tileUrl: buildWMTSTileUrl(url, params),
        tileSize: params.tileSize || 256,
        minzoom: params.minzoom || 0,
        maxzoom: params.maxzoom || 20,
        attribution: params.attribution || url,
        ...params,
      },
      sourceFormat: 'wmts',
    });
  }

  /**
   * Add an XYZ tile layer
   */
  async addXYZ(url, params = {}) {
    await layerManager.addLayer({
      name: params.name || 'XYZ Tiles',
      type: 'xyz',
      url: cleanUrl(url),
      serviceParams: {
        tileSize: params.tileSize || 256,
        minzoom: params.minzoom || 0,
        maxzoom: params.maxzoom || 20,
        attribution: params.attribution || '',
        ...params,
      },
      sourceFormat: 'xyz',
    });
  }

  /**
   * Add an ESRI Feature Service layer
   * Fetches all features and adds as vector layer
   */
  async addESRIFeatureService(url, params = {}) {
    const restUrl = url.replace(/\/?$/, '');
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Fetching features from ESRI Feature Service…' });

    try {
      // Get layer info
      const infoRes = await fetch(`${restUrl}?f=json`);
      const info = await infoRes.json();
      const name = params.name || info.name || 'ESRI Feature Layer';

      // Count features
      const countRes = await fetch(`${restUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);
      const countData = await countRes.json();
      const total = countData.count || 1000;

      // Fetch in pages of 1000
      const pageSize = 1000;
      const allFeatures = [];
      const outFields = params.outFields || '*';

      for (let offset = 0; offset < total; offset += pageSize) {
        const queryUrl = `${restUrl}/query?where=1%3D1&outFields=${outFields}&outSR=4326&f=geojson&resultOffset=${offset}&resultRecordCount=${pageSize}`;
        const res = await fetch(queryUrl);
        const page = await res.json();
        if (page.features) allFeatures.push(...page.features);
        if (page.features?.length < pageSize) break;
      }

      const geojson = { type: 'FeatureCollection', features: allFeatures };

      await layerManager.addLayer({
        name,
        type: 'esri-feature',
        data: geojson,
        url: restUrl,
        serviceParams: { ...params, esriType: 'feature' },
        sourceFormat: 'esri-feature',
        metadata: { esriInfo: info },
      });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Added ${name} (${allFeatures.length} features)` });
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `ESRI FS error: ${e.message}` });
      throw e;
    }
  }

  /**
   * Add ESRI Map Service (tiled)
   */
  async addESRIMapService(url, params = {}) {
    const restUrl = url.replace(/\/?$/, '');
    const name = params.name || 'ESRI Map Service';

    await layerManager.addLayer({
      name,
      type: 'esri-map',
      url: restUrl,
      serviceParams: { ...params, esriType: 'map' },
      sourceFormat: 'esri-map',
    });
  }

  /**
   * Add ESRI Image Service
   */
  async addESRIImageService(url, params = {}) {
    const restUrl = url.replace(/\/?$/, '');
    const tileUrl = `${restUrl}/tile/{z}/{y}/{x}`;
    const name = params.name || 'ESRI Image Service';

    await layerManager.addLayer({
      name,
      type: 'xyz',
      url: tileUrl,
      serviceParams: { ...params, tileSize: 256 },
      sourceFormat: 'esri-image',
    });
  }

  /**
   * Add a Cloud-Optimized GeoTIFF (COG) via URL
   */
  async addCOG(url, params = {}) {
    const { fromUrl } = await import('geotiff');
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Fetching COG metadata…' });

    try {
      const tiff = await fromUrl(url);
      const image = await tiff.getImage();
      const bbox = image.getBoundingBox();
      const [minX, minY, maxX, maxY] = bbox;

      const geoKeys = image.getGeoKeys();
      let crs = 'EPSG:4326';
      if (geoKeys?.ProjectedCSTypeGeoKey) crs = `EPSG:${geoKeys.ProjectedCSTypeGeoKey}`;

      let finalBbox = [[minX, minY], [maxX, maxY]];
      if (crs !== 'EPSG:4326') {
        try {
          const sw = transformCoord([minX, minY], crs, 'EPSG:4326');
          const ne = transformCoord([maxX, maxY], crs, 'EPSG:4326');
          finalBbox = [sw, ne];
        } catch(e) {}
      }

      // Render overview as image
      const overview = await tiff.getImage(image.fileDirectories.length > 1 ? image.fileDirectories.length - 1 : 0);
      const canvas = await renderGeoTIFFToCanvas(overview);
      const dataUrl = canvas.toDataURL('image/png');

      await layerManager.addLayer({
        name: params.name || url.split('/').pop() || 'COG',
        type: 'cog',
        url,
        imageUrl: dataUrl,
        bbox: finalBbox,
        opacity: 1.0,
        sourceFormat: 'cog',
        metadata: { geoKeys },
      });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'COG layer added' });
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `COG error: ${e.message}` });
      throw e;
    }
  }

  /**
   * Probe a WMS service and return available layers
   */
  async probeWMS(url) {
    const cleanedUrl = cleanUrl(url);
    const capUrl = `${cleanedUrl}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`;
    const res = await fetch(capUrl);
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');

    const layers = [];
    doc.querySelectorAll('Layer[queryable], Layer > Name').forEach(el => {
      const name = el.tagName === 'Name' ? el.textContent : el.querySelector('Name')?.textContent;
      const title = el.tagName === 'Name' ? el.parentElement?.querySelector('Title')?.textContent : el.querySelector('Title')?.textContent;
      if (name) layers.push({ name, title: title || name });
    });

    // Deduplicate
    const unique = [...new Map(layers.map(l => [l.name, l])).values()];
    return unique;
  }

  /**
   * Probe ESRI REST endpoint and return info
   */
  async probeESRI(url) {
    const restUrl = cleanUrl(url).replace(/\/?$/, '');
    const res = await fetch(`${restUrl}?f=json`);
    const info = await res.json();
    return {
      type: info.type || (info.layers ? 'MapServer' : 'FeatureServer'),
      name: info.serviceDescription || info.description || info.name || 'ESRI Service',
      layers: info.layers || [],
    };
  }

  /**
   * Download vector features from WFS
   */
  async addWFS(url, params = {}) {
    const typeName = params.typeName || params.layers || '';
    const wfsUrl = `${cleanUrl(url)}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=${typeName}&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326`;

    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Fetching WFS features…' });
    try {
      const res = await fetch(wfsUrl);
      const geojson = await res.json();
      await layerManager.addLayer({
        name: params.name || typeName || 'WFS Layer',
        type: 'esri-feature', // same as vector
        data: geojson,
        url,
        serviceParams: { ...params, wfsType: typeName },
        sourceFormat: 'wfs',
      });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `WFS: loaded ${geojson.features?.length || 0} features` });
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `WFS error: ${e.message}` });
    }
  }
}

// ---- Helpers ----
function cleanUrl(url) {
  // Remove trailing query params that would conflict
  return url.split('?')[0];
}

function buildWMTSTileUrl(url, params) {
  // If URL is already a tile template, use as-is
  if (url.includes('{z}') || url.includes('{TileMatrix}')) return url;

  const layer = params.layer || params.layers || '';
  const style = params.style || 'default';
  const format = params.format || 'image/png';
  const tilematrixset = params.tilematrixset || 'EPSG:3857';

  return `${url}?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=${layer}&STYLE=${style}&FORMAT=${format}&TILEMATRIXSET=${tilematrixset}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

async function renderGeoTIFFToCanvas(image) {
  const width = Math.min(image.getWidth(), 2048);
  const height = Math.min(image.getHeight(), 2048);
  const data = await image.readRasters({ interleave: true, width, height });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const spp = image.getSamplesPerPixel();
  let idx = 0;

  if (spp >= 3) {
    for (let i = 0; i < width * height; i++) {
      imageData.data[idx++] = data[i * spp];
      imageData.data[idx++] = data[i * spp + 1];
      imageData.data[idx++] = data[i * spp + 2];
      imageData.data[idx++] = spp >= 4 ? data[i * spp + 3] : 255;
    }
  } else {
    const sample = Array.from(data).slice(0, Math.min(10000, data.length));
    const min = Math.min(...sample);
    const max = Math.max(...sample);
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

export const serviceConnector = new ServiceConnector();
