import maplibregl from 'maplibre-gl';
import { bus, EVENTS } from '../utils/EventBus.js';
import { BasemapManager, BASEMAPS } from './BasemapManager.js';
import { formatDD, formatDMS, lngLatToMercator, zoomToScale } from '../utils/coordinates.js';

// Nova Scotia approximate bounding box center and zoom
const NS_CENTER = [-63.0, 45.0];
const NS_ZOOM = 6.5;

export class MapManager {
  constructor() {
    this._map = null;
    this._basemapMgr = null;
    this._currentBasemap = 'osm';
    this._popup = null;
  }

  init(containerId, options = {}) {
    // Base style with glyphs URL so symbol/label layers render correctly
    const style = {
      version: 8,
      sources: {},
      layers: [],
      // Public OpenMapTiles glyph CDN — supports Open Sans, Noto Sans, etc.
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    };

    this._map = new maplibregl.Map({
      container: containerId,
      style,
      center: options.center || NS_CENTER,
      zoom: options.zoom || NS_ZOOM,
      bearing: options.bearing || 0,
      pitch: options.pitch || 0,
      attributionControl: false,
    });

    // Add attribution in bottom-right
    this._map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    this._basemapMgr = new BasemapManager(this._map);
    this._currentBasemap = 'none';

    this._map.on('load', () => {
      bus.emit(EVENTS.MAP_READY, { map: this._map });
    });

    this._map.on('mousemove', (e) => {
      this._updateCoords(e.lngLat.lng, e.lngLat.lat);
    });

    this._map.on('move', () => {
      const z = this._map.getZoom();
      const center = this._map.getCenter();
      document.getElementById('zoom-display').textContent = `Zoom: ${z.toFixed(2)}`;
      const scale = zoomToScale(z, center.lat);
      document.getElementById('scale-display').textContent = `1:${scale.toLocaleString()}`;
      bus.emit(EVENTS.MAP_MOVE, { center, zoom: z });
    });

    // Popup for identify
    this._popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'webgis-popup',
    });

    return this._map;
  }

  get map() { return this._map; }

  _updateCoords(lng, lat) {
    const display = document.getElementById('coords-display');
    const crsSelect = document.getElementById('crs-select');
    if (!display || !crsSelect) return;
    const mode = crsSelect.value;
    if (mode === '4326') {
      display.innerHTML = formatDD(lng, lat);
    } else if (mode === 'dms') {
      display.innerHTML = formatDMS(lng, lat);
    } else if (mode === '3857') {
      const [mx, my] = lngLatToMercator(lng, lat);
      display.innerHTML = `X: ${mx.toFixed(1)}m &nbsp; Y: ${my.toFixed(1)}m`;
    }
  }

  setBasemap(basemapId) {
    // Basemaps are managed by BasemapLayerManager
  }

  getState() {
    if (!this._map) return null;
    return {
      center: [this._map.getCenter().lng, this._map.getCenter().lat],
      zoom: this._map.getZoom(),
      bearing: this._map.getBearing(),
      pitch: this._map.getPitch(),
      basemap: this._currentBasemap,
    };
  }

  zoomToExtent(bounds) {
    if (!bounds) return;
    this._map.fitBounds(bounds, { padding: 48, duration: 600 });
  }

  /** Fly to Nova Scotia home extent */
  flyHome() {
    this._map?.flyTo({ center: NS_CENTER, zoom: NS_ZOOM, duration: 900 });
  }

  showPopup(lngLat, html) {
    this._popup.setLngLat(lngLat).setHTML(html).addTo(this._map);
  }

  hidePopup() {
    this._popup.remove();
  }

  getMap() { return this._map; }
  getCurrentBasemap() { return 'none'; }
}

export const mapManager = new MapManager();
