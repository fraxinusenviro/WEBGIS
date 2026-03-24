import JSZip from 'jszip';
import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';

/**
 * ExportManager — handles export of layers to various formats
 */
export class ExportManager {
  /**
   * Export a vector layer as GeoJSON file download
   */
  exportGeoJSON(layerId, filename) {
    const layer = layerManager.layers.find(l => l.id === layerId);
    if (!layer?.data) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: 'No data to export' });
      return;
    }
    const json = JSON.stringify(layer.data, null, 2);
    this._downloadText(json, (filename || layer.name) + '.geojson', 'application/geo+json');
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Exported ${layer.name} as GeoJSON` });
  }

  /**
   * Export a vector layer as Shapefile (ZIP)
   */
  async exportShapefile(layerId, filename) {
    const layer = layerManager.layers.find(l => l.id === layerId);
    if (!layer?.data) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: 'No data to export' });
      return;
    }

    try {
      const shpwrite = await import('shp-write');
      const options = {
        folder: filename || layer.name,
        filename: filename || layer.name,
        outputType: 'blob',
        compression: 'DEFLATE',
        types: {
          point: 'points',
          polygon: 'polygons',
          polyline: 'polylines',
        },
      };
      const blob = await shpwrite.default.zip(layer.data, options);
      this._downloadBlob(blob, (filename || layer.name) + '.zip');
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Exported ${layer.name} as Shapefile` });
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Shapefile export failed: ${e.message}` });
    }
  }

  /**
   * Export a vector layer as CSV (points only)
   */
  exportCSV(layerId, filename) {
    const layer = layerManager.layers.find(l => l.id === layerId);
    if (!layer?.data) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: 'No data to export' });
      return;
    }

    const features = layer.data.features;
    if (!features.length) return;

    const allKeys = new Set();
    features.forEach(f => Object.keys(f.properties || {}).forEach(k => allKeys.add(k)));
    const keys = Array.from(allKeys);

    const rows = [['longitude', 'latitude', ...keys]];
    for (const f of features) {
      if (f.geometry?.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates;
      rows.push([lng, lat, ...keys.map(k => f.properties?.[k] ?? '')]);
    }

    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    this._downloadText(csv, (filename || layer.name) + '.csv', 'text/csv');
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Exported ${layer.name} as CSV` });
  }

  /**
   * Export as KML
   */
  exportKML(layerId, filename) {
    const layer = layerManager.layers.find(l => l.id === layerId);
    if (!layer?.data) return;

    const kml = geojsonToKML(layer.data, layer.name);
    this._downloadText(kml, (filename || layer.name) + '.kml', 'application/vnd.google-earth.kml+xml');
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Exported ${layer.name} as KML` });
  }

  /**
   * Download layer as GeoPackage-compatible GeoJSON (named .gpkg.json)
   * Full GeoPackage (SQLite) is not feasible in browser; GeoJSON is the practical equivalent
   */
  exportGeoPackage(layerId, filename) {
    this.exportGeoJSON(layerId, filename);
  }

  // ---- Helpers ----
  _downloadText(text, filename, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime });
    this._downloadBlob(blob, filename);
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// ---- GeoJSON → KML ----
function geojsonToKML(geojson, name) {
  const placemarks = geojson.features.map(f => {
    const props = f.properties || {};
    const propXml = Object.entries(props)
      .map(([k, v]) => `<Data name="${escapeXml(k)}"><value>${escapeXml(String(v ?? ''))}</value></Data>`)
      .join('\n');
    const geomXml = geomToKML(f.geometry);
    return `<Placemark>
  <name>${escapeXml(props.name || '')}</name>
  <ExtendedData>${propXml}</ExtendedData>
  ${geomXml}
</Placemark>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
  <name>${escapeXml(name)}</name>
  ${placemarks}
</Document>
</kml>`;
}

function geomToKML(geom) {
  if (!geom) return '';
  switch(geom.type) {
    case 'Point':
      return `<Point><coordinates>${geom.coordinates.join(',')},0</coordinates></Point>`;
    case 'LineString':
      return `<LineString><coordinates>${geom.coordinates.map(c => c.join(',')).join(' ')}</coordinates></LineString>`;
    case 'Polygon':
      return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${
        geom.coordinates[0].map(c => c.join(',')).join(' ')
      }</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    default: return '';
  }
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const exportManager = new ExportManager();
