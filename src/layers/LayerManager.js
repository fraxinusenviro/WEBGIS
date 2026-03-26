import { bus, EVENTS } from '../utils/EventBus.js';
import { uid } from '../utils/uid.js';
import { getBounds } from '../utils/coordinates.js';
import { storage } from '../storage/StorageManager.js';

/** Supported point symbol shapes */
export const POINT_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'x', 'octagon', 'star', 'pentagon'];

/** Default styles for each geometry type */
export const DEFAULT_STYLES = {
  Point: {
    type: 'single',
    pointColor: '#60a5fa',
    pointRadius: 6,
    pointShape: 'circle',     // circle | square | triangle | diamond | cross | x | octagon | star | pentagon
    pointOpacity: 0.85,
    strokeColor: '#ffffff',
    strokeWidth: 1.5,
    strokeOpacity: 1,
    labelField: null,
    labelSize: 12,
    labelColor: '#ffffff',
    labelHaloColor: '#0d1a10',
    labelHaloWidth: 1,
  },
  LineString: {
    type: 'single',
    lineColor: '#f97316',
    lineWidth: 2,
    lineOpacity: 0.9,
    lineDashArray: null,
    labelField: null,
    labelSize: 12,
    labelColor: '#ffffff',
    labelHaloColor: '#0d1a10',
    labelHaloWidth: 1,
  },
  Polygon: {
    type: 'single',
    fillColor: '#a78bfa',
    fillOpacity: 0.35,
    strokeColor: '#a78bfa',
    strokeWidth: 1.5,
    strokeOpacity: 1,
    labelField: null,
    labelSize: 12,
    labelColor: '#ffffff',
    labelHaloColor: '#0d1a10',
    labelHaloWidth: 1,
  },
  Raster: {
    opacity: 1.0,
  },
  Tile: {
    opacity: 1.0,
  },
};

/** Detect primary geometry type from FeatureCollection */
export function detectGeometryType(geojson) {
  for (const f of (geojson.features || [])) {
    if (!f.geometry) continue;
    const t = f.geometry.type;
    if (t === 'Point' || t === 'MultiPoint') return 'Point';
    if (t === 'LineString' || t === 'MultiLineString') return 'LineString';
    if (t === 'Polygon' || t === 'MultiPolygon') return 'Polygon';
  }
  return 'Point';
}

export class LayerManager {
  constructor() {
    this._layers = []; // ordered list of layer objects (top = front)
    this._map = null;
    this._ready = false;

    bus.on(EVENTS.MAP_READY, ({ map }) => {
      this._map = map;
      this._ready = true;
    });

    // After basemap change, re-add all layers
    bus.on('map:basemapReady', () => {
      this._readdAllLayers();
    });
  }

  get layers() { return [...this._layers]; }

  /** Add a new layer */
  async addLayer(config) {
    const layer = this._buildLayerObject(config);
    this._layers.push(layer);

    // Persist large GeoJSON data separately
    if (layer.data && layer.type === 'vector') {
      await storage.saveLayerData(layer.id, layer.data);
    }

    if (this._ready) {
      this._addToMap(layer);
    }

    bus.emit(EVENTS.LAYER_ADDED, layer);
    bus.emit(EVENTS.PROJECT_DIRTY);
    return layer;
  }

  /** Remove a layer */
  async removeLayer(id) {
    const idx = this._layers.findIndex(l => l.id === id);
    if (idx < 0) return;
    const layer = this._layers[idx];
    this._layers.splice(idx, 1);
    this._removeFromMap(layer);
    if (this._map) this._map.triggerRepaint?.();
    await storage.deleteLayerData(id);
    bus.emit(EVENTS.LAYER_REMOVED, layer);
    bus.emit(EVENTS.PROJECT_DIRTY);
  }

  /** Update layer (visibility, opacity, style, name) */
  updateLayer(id, updates) {
    const layer = this._getLayer(id);
    if (!layer) return;
    Object.assign(layer, updates);
    this._applyStyle(layer);
    bus.emit(EVENTS.LAYER_UPDATED, layer);
    bus.emit(EVENTS.PROJECT_DIRTY);
  }

  /** Update layer style */
  updateStyle(id, style) {
    const layer = this._getLayer(id);
    if (!layer) return;
    layer.style = { ...layer.style, ...style };
    this._applyStyle(layer);
    bus.emit(EVENTS.LAYER_STYLE_CHANGE, layer);
    bus.emit(EVENTS.PROJECT_DIRTY);
  }

  /** Toggle visibility */
  toggleVisibility(id) {
    const layer = this._getLayer(id);
    if (!layer) return;
    layer.visible = !layer.visible;
    this._setVisibility(layer);
    bus.emit(EVENTS.LAYER_VISIBILITY, layer);
    bus.emit(EVENTS.PROJECT_DIRTY);
  }

  /** Reorder layers */
  reorderLayers(orderedIds) {
    const map = new Map(this._layers.map(l => [l.id, l]));
    this._layers = orderedIds.map(id => map.get(id)).filter(Boolean);
    this._syncMapOrder();
    bus.emit(EVENTS.LAYER_ORDER, this._layers.map(l => l.id));
    bus.emit(EVENTS.LAYER_UPDATED, null);
    bus.emit(EVENTS.PROJECT_DIRTY);
  }

  /** Zoom to layer extent */
  zoomToLayer(id) {
    const layer = this._getLayer(id);
    if (!layer) return;
    if (layer.bbox) {
      const [[minX, minY], [maxX, maxY]] = layer.bbox;
      this._map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 48, duration: 600 });
    }
  }

  /** Get layer by id */
  _getLayer(id) {
    return this._layers.find(l => l.id === id);
  }

  /** Build normalized layer object */
  _buildLayerObject(config) {
    const id = config.id || uid('layer');
    const geomType = config.geometryType || (config.data ? detectGeometryType(config.data) : 'Point');
    const defaultStyle = DEFAULT_STYLES[geomType] || DEFAULT_STYLES.Point;

    const layer = {
      id,
      name: config.name || 'New Layer',
      type: config.type || 'vector',    // vector | raster | wms | wmts | xyz | esri-feature | esri-map | cog | mbtiles
      geometryType: geomType,
      visible: config.visible !== false,
      opacity: config.opacity ?? 1.0,
      style: { ...defaultStyle, ...(config.style || {}) },
      data: config.data || null,         // GeoJSON FeatureCollection (for vector)
      url: config.url || null,           // for tile/service layers
      serviceParams: config.serviceParams || {},
      bbox: config.bbox || (config.data ? getBounds(config.data) : null),
      sourceFormat: config.sourceFormat || null,
      metadata: config.metadata || {},
      embedded: config.embedded || false,
      _mlSourceId: `src-${id}`,
      _mlLayerIds: [],
    };

    return layer;
  }

  /** Add layer to MapLibre map */
  _addToMap(layer) {
    if (!this._map) return;
    try {
      switch(layer.type) {
        case 'vector':       this._addVectorLayer(layer); break;
        case 'wms':          this._addWMSLayer(layer); break;
        case 'wmts':         this._addWMTSLayer(layer); break;
        case 'xyz':          this._addXYZLayer(layer); break;
        case 'esri-feature': this._addESRIFeatureLayer(layer); break;
        case 'esri-map':     this._addESRIMapLayer(layer); break;
        case 'cog':          this._addCOGLayer(layer); break;
        case 'mbtiles':      this._addMBTilesLayer(layer); break;
        case 'image':        this._addImageLayer(layer); break;
        default: console.warn('Unknown layer type:', layer.type);
      }
    } catch(e) {
      console.error('Error adding layer to map:', e);
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Failed to render layer: ${layer.name}` });
    }
  }

  _addVectorLayer(layer) {
    const map = this._map;
    const srcId = layer._mlSourceId;
    const data = layer.data || { type: 'FeatureCollection', features: [] };

    if (map.getSource(srcId)) map.removeSource(srcId);
    map.addSource(srcId, { type: 'geojson', data, generateId: true });

    const layerIds = [];
    const style = layer.style;
    const gt = layer.geometryType;

    if (gt === 'Polygon') {
      // Fill layer
      const fillId = `${layer.id}-fill`;
      map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
        paint: {
          'fill-color': this._getFillExpression(layer),
          'fill-opacity': ['*', (style.fillOpacity ?? 0.35), layer.opacity],
        },
        layout: { visibility: layer.visible ? 'visible' : 'none' },
      });
      layerIds.push(fillId);

      // Stroke layer
      const lineId = `${layer.id}-line`;
      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        filter: ['any', ['==', ['geometry-type'], 'Polygon'], ['==', ['geometry-type'], 'MultiPolygon']],
        paint: {
          'line-color': style.strokeColor || style.fillColor || '#a78bfa',
          'line-width': style.strokeWidth || 1.5,
          'line-opacity': ['*', (style.strokeOpacity ?? 1), layer.opacity],
        },
        layout: { visibility: layer.visible ? 'visible' : 'none' },
      });
      layerIds.push(lineId);

    } else if (gt === 'LineString') {
      const lineId = `${layer.id}-line`;
      const paint = {
        'line-color': this._getFillExpression(layer),
        'line-width': style.lineWidth || 2,
        'line-opacity': ['*', (style.lineOpacity ?? 0.9), layer.opacity],
      };
      if (style.lineDashArray) paint['line-dasharray'] = style.lineDashArray;

      map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        paint,
        layout: {
          visibility: layer.visible ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round',
        },
      });
      layerIds.push(lineId);

    } else { // Point
      const shape = style.pointShape || 'circle';
      const useSymbol = shape !== 'circle' && style.type === 'single';
      const hasCatShapes = style.type === 'categorized' && style.classificationField && style.classes?.length && style.classes.some(c => c.shape && c.shape !== 'circle');

      if (hasCatShapes) {
        // Per-category shapes via match expression on icon-image
        const fallbackKey = this._ensureMarkerImage('circle', style.pointColor || '#60a5fa', (style.pointRadius || 6) * 2, style.strokeColor || '#ffffff', style.strokeWidth || 1.5);
        const pairs = [];
        for (const cls of style.classes) {
          const iconKey = this._ensureMarkerImage(cls.shape || 'circle', cls.color, (style.pointRadius || 6) * 2, style.strokeColor || '#ffffff', style.strokeWidth || 1.5);
          pairs.push(cls.value, iconKey);
        }
        const iconExpr = ['match', ['get', style.classificationField], ...pairs, fallbackKey];
        const symbolId = `${layer.id}-symbol`;
        map.addLayer({
          id: symbolId,
          type: 'symbol',
          source: srcId,
          filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          layout: {
            'icon-image': iconExpr,
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            visibility: layer.visible ? 'visible' : 'none',
          },
          paint: {
            'icon-opacity': ['*', (style.pointOpacity ?? 0.85), layer.opacity],
          },
        });
        layerIds.push(symbolId);
      } else if (useSymbol) {
        // Custom shape via symbol layer with canvas-drawn icon image
        const iconKey = this._ensureMarkerImage(
          shape,
          style.pointColor || '#60a5fa',
          (style.pointRadius || 6) * 2,
          style.strokeColor || '#ffffff',
          style.strokeWidth || 1.5,
        );
        const symbolId = `${layer.id}-symbol`;
        map.addLayer({
          id: symbolId,
          type: 'symbol',
          source: srcId,
          filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          layout: {
            'icon-image': iconKey,
            'icon-size': 1,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            visibility: layer.visible ? 'visible' : 'none',
          },
          paint: {
            'icon-opacity': ['*', (style.pointOpacity ?? 0.85), layer.opacity],
          },
        });
        layerIds.push(symbolId);
      } else {
        // Default circle layer (supports color expressions for classification)
        const circleId = `${layer.id}-circle`;
        map.addLayer({
          id: circleId,
          type: 'circle',
          source: srcId,
          filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
          paint: {
            'circle-color': this._getFillExpression(layer),
            'circle-radius': style.pointRadius || 6,
            'circle-opacity': ['*', (style.pointOpacity ?? 0.85), layer.opacity],
            'circle-stroke-color': style.strokeColor || '#ffffff',
            'circle-stroke-width': style.strokeWidth || 1.5,
            'circle-stroke-opacity': ['*', (style.strokeOpacity ?? 1), layer.opacity],
          },
          layout: { visibility: layer.visible ? 'visible' : 'none' },
        });
        layerIds.push(circleId);
      }
    }

    // Label layer (if labelField set)
    if (style.labelField) {
      const labelId = `${layer.id}-label`;
      map.addLayer({
        id: labelId,
        type: 'symbol',
        source: srcId,
        layout: {
          'text-field': ['get', style.labelField],
          'text-size': style.labelSize || 12,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-offset': gt === 'Point' ? [0, 1.2] : [0, 0],
          'text-anchor': gt === 'Point' ? 'top' : 'center',
          'text-max-width': 8,
          'text-allow-overlap': false,
          visibility: layer.visible ? 'visible' : 'none',
        },
        paint: {
          'text-color': style.labelColor || '#ffffff',
          'text-halo-color': style.labelHaloColor || '#0d1a10',
          'text-halo-width': style.labelHaloWidth || 1,
          'text-opacity': layer.opacity,
        },
      });
      layerIds.push(labelId);
    }

    layer._mlLayerIds = layerIds;
  }

  _addWMSLayer(layer) {
    const map = this._map;
    const srcId = layer._mlSourceId;
    const p = layer.serviceParams;
    const version = p.version || '1.3.0';
    const crs = version === '1.3.0' ? 'CRS=EPSG:3857' : 'SRS=EPSG:3857';
    const tileUrl = `${layer.url}?SERVICE=WMS&VERSION=${version}&REQUEST=GetMap&BBOX={bbox-epsg-3857}&WIDTH=256&HEIGHT=256&LAYERS=${encodeURIComponent(p.layers || '')}&STYLES=${p.styles || ''}&FORMAT=${p.format || 'image/png'}&TRANSPARENT=true&${crs}`;

    map.addSource(srcId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      attribution: p.attribution || layer.name,
    });
    const mlId = `${layer.id}-wms`;
    map.addLayer({
      id: mlId,
      type: 'raster',
      source: srcId,
      paint: { 'raster-opacity': layer.opacity },
      layout: { visibility: layer.visible ? 'visible' : 'none' },
    });
    layer._mlLayerIds = [mlId];
  }

  _addWMTSLayer(layer) {
    const map = this._map;
    const srcId = layer._mlSourceId;
    const p = layer.serviceParams;
    // WMTS REST-style URL template
    const tileUrl = p.tileUrl || layer.url;

    map.addSource(srcId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: p.tileSize || 256,
      attribution: p.attribution || layer.name,
      minzoom: p.minzoom || 0,
      maxzoom: p.maxzoom || 20,
    });
    const mlId = `${layer.id}-wmts`;
    map.addLayer({
      id: mlId,
      type: 'raster',
      source: srcId,
      paint: { 'raster-opacity': layer.opacity },
      layout: { visibility: layer.visible ? 'visible' : 'none' },
    });
    layer._mlLayerIds = [mlId];
  }

  _addXYZLayer(layer) {
    const map = this._map;
    const srcId = layer._mlSourceId;
    const p = layer.serviceParams;

    map.addSource(srcId, {
      type: 'raster',
      tiles: [layer.url],
      tileSize: p.tileSize || 256,
      attribution: p.attribution || layer.name,
      minzoom: p.minzoom || 0,
      maxzoom: p.maxzoom || 20,
    });
    const mlId = `${layer.id}-xyz`;
    map.addLayer({
      id: mlId,
      type: 'raster',
      source: srcId,
      paint: { 'raster-opacity': layer.opacity },
      layout: { visibility: layer.visible ? 'visible' : 'none' },
    });
    layer._mlLayerIds = [mlId];
  }

  _addESRIMapLayer(layer) {
    const map = this._map;
    const srcId = layer._mlSourceId;
    const tileUrl = `${layer.url}/tile/{z}/{y}/{x}`;

    map.addSource(srcId, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      attribution: 'Powered by Esri',
    });
    const mlId = `${layer.id}-esrimap`;
    map.addLayer({
      id: mlId,
      type: 'raster',
      source: srcId,
      paint: { 'raster-opacity': layer.opacity },
      layout: { visibility: layer.visible ? 'visible' : 'none' },
    });
    layer._mlLayerIds = [mlId];
  }

  _addESRIFeatureLayer(layer) {
    // Data already fetched and stored as GeoJSON in layer.data
    this._addVectorLayer(layer);
  }

  _addCOGLayer(layer) {
    // COG rendered via streaming tile protocol (cog://) — no full file download.
    // Falls back to the legacy image-source approach if tileUrl is absent
    // (e.g. layers loaded from an older project save).
    const map = this._map;
    const srcId = layer._mlSourceId;

    if (layer.tileUrl) {
      // Preferred path: tile-based streaming
      map.addSource(srcId, {
        type: 'raster',
        tiles: [layer.tileUrl],
        tileSize: 256,
        // Restrict tile requests to the known data extent
        ...(layer.bbox ? (() => {
          const [[minX, minY], [maxX, maxY]] = layer.bbox;
          return { bounds: [minX, minY, maxX, maxY] };
        })() : {}),
      });
    } else if (layer.imageUrl && layer.bbox) {
      // Legacy fallback: static image source
      const [[minX, minY], [maxX, maxY]] = layer.bbox;
      map.addSource(srcId, {
        type: 'image',
        url: layer.imageUrl,
        coordinates: [
          [minX, maxY], [maxX, maxY],
          [maxX, minY], [minX, minY],
        ],
      });
    } else {
      console.warn('_addCOGLayer: layer has neither tileUrl nor imageUrl+bbox', layer.id);
      return;
    }

    const mlId = `${layer.id}-cog`;
    map.addLayer({
      id: mlId,
      type: 'raster',
      source: srcId,
      paint: { 'raster-opacity': layer.opacity },
      layout: { visibility: layer.visible ? 'visible' : 'none' },
    });
    layer._mlLayerIds = [mlId];
  }

  _addMBTilesLayer(layer) {
    // MBTiles served via object URL of decoded tiles
    const map = this._map;
    if (!layer.tileFunction) {
      // Fallback to plain URL if served via local server
      this._addXYZLayer({ ...layer, url: layer.url });
      return;
    }
    // For now add as raster-tile with custom protocol handled externally
    const srcId = layer._mlSourceId;
    map.addSource(srcId, {
      type: 'raster',
      tiles: [`mbtiles://${layer.id}/{z}/{x}/{y}`],
      tileSize: 256,
    });
    const mlId = `${layer.id}-mbtiles`;
    map.addLayer({
      id: mlId, type: 'raster', source: srcId,
      paint: { 'raster-opacity': layer.opacity },
      layout: { visibility: layer.visible ? 'visible' : 'none' },
    });
    layer._mlLayerIds = [mlId];
  }

  _addImageLayer(layer) {
    const map = this._map;
    if (!layer.imageUrl || !layer.bbox) return;
    const srcId = layer._mlSourceId;
    const [[minX, minY], [maxX, maxY]] = layer.bbox;

    map.addSource(srcId, {
      type: 'image',
      url: layer.imageUrl,
      coordinates: [
        [minX, maxY], [maxX, maxY],
        [maxX, minY], [minX, minY],
      ],
    });
    const mlId = `${layer.id}-img`;
    map.addLayer({
      id: mlId, type: 'raster', source: srcId,
      paint: { 'raster-opacity': layer.opacity },
      layout: { visibility: layer.visible ? 'visible' : 'none' },
    });
    layer._mlLayerIds = [mlId];
  }

  /** Remove layer from map */
  _removeFromMap(layer) {
    if (!this._map) return;
    for (const id of (layer._mlLayerIds || [])) {
      if (this._map.getLayer(id)) this._map.removeLayer(id);
    }
    if (this._map.getSource(layer._mlSourceId)) {
      this._map.removeSource(layer._mlSourceId);
    }
    layer._mlLayerIds = [];
  }

  /** Apply current style to existing MapLibre layers */
  _applyStyle(layer) {
    if (!this._map) return;
    const style = layer.style;
    const gt = layer.geometryType;
    const op = layer.opacity;

    if (layer.type === 'vector') {
      if (gt === 'Polygon') {
        const fillId = `${layer.id}-fill`;
        const lineId = `${layer.id}-line`;
        if (this._map.getLayer(fillId)) {
          this._map.setPaintProperty(fillId, 'fill-color', this._getFillExpression(layer));
          this._map.setPaintProperty(fillId, 'fill-opacity', ['*', (style.fillOpacity ?? 0.35), op]);
        }
        if (this._map.getLayer(lineId)) {
          this._map.setPaintProperty(lineId, 'line-color', style.strokeColor || style.fillColor || '#a78bfa');
          this._map.setPaintProperty(lineId, 'line-width', style.strokeWidth || 1.5);
          this._map.setPaintProperty(lineId, 'line-opacity', ['*', (style.strokeOpacity ?? 1), op]);
        }
      } else if (gt === 'LineString') {
        const lineId = `${layer.id}-line`;
        if (this._map.getLayer(lineId)) {
          this._map.setPaintProperty(lineId, 'line-color', this._getFillExpression(layer));
          this._map.setPaintProperty(lineId, 'line-width', style.lineWidth || 2);
          this._map.setPaintProperty(lineId, 'line-opacity', ['*', (style.lineOpacity ?? 0.9), op]);
        }
      } else {
        // Handle circle vs symbol shape transitions
        const shape = style.pointShape || 'circle';
        const useSymbol = shape !== 'circle' && style.type === 'single';
        const hasCatShapes = style.type === 'categorized' && style.classificationField && style.classes?.length && style.classes.some(c => c.shape && c.shape !== 'circle');
        const circleId = `${layer.id}-circle`;
        const symbolId = `${layer.id}-symbol`;

        if (hasCatShapes) {
          // Remove circle layer if exists
          if (this._map.getLayer(circleId)) {
            this._map.removeLayer(circleId);
            layer._mlLayerIds = layer._mlLayerIds.filter(id => id !== circleId);
          }
          // Build match expression for per-category icon-image
          const fallbackKey = this._ensureMarkerImage('circle', style.pointColor || '#60a5fa', (style.pointRadius || 6) * 2, style.strokeColor || '#ffffff', style.strokeWidth || 1.5);
          const pairs = [];
          for (const cls of style.classes) {
            const iconKey = this._ensureMarkerImage(cls.shape || 'circle', cls.color, (style.pointRadius || 6) * 2, style.strokeColor || '#ffffff', style.strokeWidth || 1.5);
            pairs.push(cls.value, iconKey);
          }
          const iconExpr = ['match', ['get', style.classificationField], ...pairs, fallbackKey];
          if (!this._map.getLayer(symbolId)) {
            const srcId = layer._mlSourceId;
            this._map.addLayer({
              id: symbolId,
              type: 'symbol',
              source: srcId,
              filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
              layout: {
                'icon-image': iconExpr,
                'icon-size': 1,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                visibility: layer.visible ? 'visible' : 'none',
              },
              paint: { 'icon-opacity': ['*', (style.pointOpacity ?? 0.85), op] },
            });
            if (!layer._mlLayerIds.includes(symbolId)) layer._mlLayerIds.push(symbolId);
          } else {
            this._map.setLayoutProperty(symbolId, 'icon-image', iconExpr);
            this._map.setPaintProperty(symbolId, 'icon-opacity', ['*', (style.pointOpacity ?? 0.85), op]);
          }
        } else if (useSymbol) {
          // Remove circle layer if it exists
          if (this._map.getLayer(circleId)) {
            this._map.removeLayer(circleId);
            layer._mlLayerIds = layer._mlLayerIds.filter(id => id !== circleId);
          }
          // Add/update symbol layer
          const iconKey = this._ensureMarkerImage(
            shape,
            style.pointColor || '#60a5fa',
            (style.pointRadius || 6) * 2,
            style.strokeColor || '#ffffff',
            style.strokeWidth || 1.5,
          );
          if (!this._map.getLayer(symbolId)) {
            const srcId = layer._mlSourceId;
            this._map.addLayer({
              id: symbolId,
              type: 'symbol',
              source: srcId,
              filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
              layout: {
                'icon-image': iconKey,
                'icon-size': 1,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
                visibility: layer.visible ? 'visible' : 'none',
              },
              paint: { 'icon-opacity': ['*', (style.pointOpacity ?? 0.85), op] },
            });
            if (!layer._mlLayerIds.includes(symbolId)) layer._mlLayerIds.push(symbolId);
          } else {
            this._map.setLayoutProperty(symbolId, 'icon-image', iconKey);
            this._map.setPaintProperty(symbolId, 'icon-opacity', ['*', (style.pointOpacity ?? 0.85), op]);
          }
        } else {
          // Remove symbol layer if it exists
          if (this._map.getLayer(symbolId)) {
            this._map.removeLayer(symbolId);
            layer._mlLayerIds = layer._mlLayerIds.filter(id => id !== symbolId);
          }
          // Add/update circle layer
          if (!this._map.getLayer(circleId)) {
            const srcId = layer._mlSourceId;
            this._map.addLayer({
              id: circleId,
              type: 'circle',
              source: srcId,
              filter: ['any', ['==', ['geometry-type'], 'Point'], ['==', ['geometry-type'], 'MultiPoint']],
              paint: {
                'circle-color': this._getFillExpression(layer),
                'circle-radius': style.pointRadius || 6,
                'circle-opacity': ['*', (style.pointOpacity ?? 0.85), op],
                'circle-stroke-color': style.strokeColor || '#ffffff',
                'circle-stroke-width': style.strokeWidth || 1.5,
                'circle-stroke-opacity': ['*', (style.strokeOpacity ?? 1), op],
              },
              layout: { visibility: layer.visible ? 'visible' : 'none' },
            });
            if (!layer._mlLayerIds.includes(circleId)) layer._mlLayerIds.push(circleId);
          } else {
            this._map.setPaintProperty(circleId, 'circle-color', this._getFillExpression(layer));
            this._map.setPaintProperty(circleId, 'circle-radius', style.pointRadius || 6);
            this._map.setPaintProperty(circleId, 'circle-opacity', ['*', (style.pointOpacity ?? 0.85), op]);
            this._map.setPaintProperty(circleId, 'circle-stroke-color', style.strokeColor || '#ffffff');
            this._map.setPaintProperty(circleId, 'circle-stroke-width', style.strokeWidth || 1.5);
          }
        }
      }

      // Labels
      const labelId = `${layer.id}-label`;
      if (style.labelField) {
        if (!this._map.getLayer(labelId)) {
          const srcId = layer._mlSourceId;
          this._map.addLayer({
            id: labelId,
            type: 'symbol',
            source: srcId,
            layout: {
              'text-field': ['get', style.labelField],
              'text-size': style.labelSize || 12,
              'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
              'text-offset': gt === 'Point' ? [0, 1.2] : [0, 0],
              'text-anchor': gt === 'Point' ? 'top' : 'center',
              'text-max-width': 8,
              visibility: layer.visible ? 'visible' : 'none',
            },
            paint: {
              'text-color': style.labelColor || '#ffffff',
              'text-halo-color': style.labelHaloColor || '#0d1a10',
              'text-halo-width': style.labelHaloWidth || 1,
              'text-opacity': op,
            },
          });
          if (!layer._mlLayerIds.includes(labelId)) layer._mlLayerIds.push(labelId);
        } else {
          this._map.setLayoutProperty(labelId, 'text-field', ['get', style.labelField]);
          this._map.setLayoutProperty(labelId, 'text-size', style.labelSize || 12);
          this._map.setPaintProperty(labelId, 'text-color', style.labelColor || '#ffffff');
          this._map.setPaintProperty(labelId, 'text-halo-color', style.labelHaloColor || '#0d1a10');
          this._map.setPaintProperty(labelId, 'text-opacity', op);
        }
      } else if (this._map.getLayer(labelId)) {
        this._map.removeLayer(labelId);
        layer._mlLayerIds = layer._mlLayerIds.filter(id => id !== labelId);
      }

    } else {
      // Raster-type layers
      for (const mlId of layer._mlLayerIds) {
        if (this._map.getLayer(mlId)) {
          this._map.setPaintProperty(mlId, 'raster-opacity', op);
        }
      }
    }
  }

  /** Get color expression based on classification type */
  _getFillExpression(layer) {
    const style = layer.style;
    const gt = layer.geometryType;
    const baseColor = gt === 'Polygon' ? (style.fillColor || '#a78bfa')
                    : gt === 'LineString' ? (style.lineColor || '#f97316')
                    : (style.pointColor || '#60a5fa');

    if (style.type === 'graduated' && style.classificationField && style.classes?.length) {
      const expr = ['step', ['get', style.classificationField]];
      expr.push(style.classes[0].color);
      for (let i = 0; i < style.classes.length - 1; i++) {
        expr.push(style.classes[i].max);
        expr.push(style.classes[i + 1].color);
      }
      return expr;
    }

    if (style.type === 'categorized' && style.classificationField && style.classes?.length) {
      const expr = ['match', ['get', style.classificationField]];
      for (const cls of style.classes) {
        expr.push(cls.value, cls.color);
      }
      expr.push(style.defaultColor || '#888888');
      return expr;
    }

    return baseColor;
  }

  /** Set visibility of map layers */
  _setVisibility(layer) {
    if (!this._map) return;
    const vis = layer.visible ? 'visible' : 'none';
    for (const id of layer._mlLayerIds) {
      if (this._map.getLayer(id)) this._map.setLayoutProperty(id, 'visibility', vis);
    }
  }

  /** Sync z-order of MapLibre layers to match _layers array (top of array = on top of map) */
  _syncMapOrder() {
    if (!this._map) return;
    // Collect all user ML layer IDs in order from bottom (_layers[0]) to top (_layers[last])
    const allMlIds = [];
    for (const layer of this._layers) {
      for (const mlId of (layer._mlLayerIds || [])) {
        if (this._map.getLayer(mlId)) allMlIds.push(mlId);
      }
    }
    // Move from bottom to top - each one moves to top sequentially
    // so the last one ends up on top, preserving relative order
    for (const mlId of allMlIds) {
      try { this._map.moveLayer(mlId); } catch(e) {}
    }
  }

  /** Re-add all layers after basemap change */
  _readdAllLayers() {
    for (const layer of this._layers) {
      layer._mlLayerIds = [];
      this._addToMap(layer);
    }
  }

  /** Update GeoJSON data for a vector layer */
  updateData(id, geojson) {
    const layer = this._getLayer(id);
    if (!layer || layer.type !== 'vector') return;
    layer.data = geojson;
    layer.bbox = getBounds(geojson);
    const src = this._map?.getSource(layer._mlSourceId);
    if (src) src.setData(geojson);
    storage.saveLayerData(id, geojson);
    bus.emit(EVENTS.LAYER_UPDATED, layer);
    bus.emit(EVENTS.PROJECT_DIRTY);
  }

  /** Serialize layers for project save (strip runtime _ml fields and large data) */
  serialize(embedData = false) {
    return this._layers.map(l => {
      const s = {
        id: l.id,
        name: l.name,
        type: l.type,
        geometryType: l.geometryType,
        visible: l.visible,
        opacity: l.opacity,
        style: l.style,
        url: l.url,
        serviceParams: l.serviceParams,
        bbox: l.bbox,
        sourceFormat: l.sourceFormat,
        metadata: l.metadata,
        embedded: l.embedded,
      };
      if (embedData && l.data) {
        s.data = l.data;
        s.embedded = true;
      }
      return s;
    });
  }

  /** Restore layers from serialized project (after calling clearAll) */
  async deserialize(layers) {
    for (const config of layers) {
      // Load data from storage if not embedded
      if (!config.data && config.type === 'vector') {
        config.data = await storage.loadLayerData(config.id);
      }
      const layer = this._buildLayerObject(config);
      this._layers.push(layer);
      if (this._ready) this._addToMap(layer);
    }
    bus.emit(EVENTS.LAYER_ADDED, null);
  }

  /** Clear all layers */
  async clearAll() {
    for (const layer of [...this._layers]) {
      await this.removeLayer(layer.id);
    }
  }

  /**
   * Ensure a marker image is loaded on the map for the given shape/color.
   * Returns the image key (to use as icon-image).
   */
  _ensureMarkerImage(shape, color, diameter, strokeColor, strokeWidth) {
    if (!this._map) return null;
    const size = Math.max(16, Math.min(64, Math.round(diameter * 1.5)));
    const key = `marker-${shape}-${color.replace('#', '')}-${size}-${strokeColor.replace('#', '')}-${Math.round(strokeWidth)}`;
    if (!this._map.hasImage(key)) {
      const canvas = createMarkerCanvas(shape, size, color, strokeColor, strokeWidth);
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, size, size);
      this._map.addImage(key, imageData);
    }
    return key;
  }

  /** Get all fields from a vector layer */
  getFields(id) {
    const layer = this._getLayer(id);
    if (!layer?.data?.features?.length) return [];
    const props = layer.data.features[0].properties || {};
    return Object.keys(props);
  }

  /** Get features from click on map */
  queryFeatures(point, layerId) {
    if (!this._map) return [];
    const layer = this._getLayer(layerId);
    if (!layer) return [];
    return this._map.queryRenderedFeatures(point, { layers: layer._mlLayerIds });
  }

  /** Generate and cache a symbol image on the map for non-circle point types */
  _ensureSymbolImage(map, sym, fillColor, strokeColor, strokeWidth) {
    const iconName = `wgis-sym-${sym}`;
    if (map.hasImage(iconName)) return;
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2, cy = size / 2, r = size * 0.38;

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1, strokeWidth * 1.5);

    ctx.beginPath();
    switch (sym) {
      case 'square':
        ctx.rect(cx - r, cy - r, r * 2, r * 2);
        break;
      case 'triangle':
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy + r);
        ctx.lineTo(cx - r, cy + r);
        ctx.closePath();
        break;
      case 'diamond':
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        break;
      case 'cross': {
        const arm = r * 0.35;
        ctx.rect(cx - arm, cy - r, arm * 2, r * 2);
        ctx.rect(cx - r, cy - arm, r * 2, arm * 2);
        break;
      }
      case 'x': {
        ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
        ctx.lineWidth = r * 0.55;
        ctx.strokeStyle = fillColor;
        ctx.stroke();
        // Also draw outer stroke
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(1, strokeWidth * 1.5);
        ctx.beginPath();
        ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
        ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
        ctx.stroke();
        const imgData = ctx.getImageData(0, 0, size, size);
        map.addImage(iconName, { width: size, height: size, data: imgData.data });
        return;
      }
      case 'star': {
        const spikes = 5, outerR = r, innerR = r * 0.4;
        for (let i = 0; i < spikes * 2; i++) {
          const angle = (i * Math.PI) / spikes - Math.PI / 2;
          const rad = i % 2 === 0 ? outerR : innerR;
          if (i === 0) ctx.moveTo(cx + rad * Math.cos(angle), cy + rad * Math.sin(angle));
          else ctx.lineTo(cx + rad * Math.cos(angle), cy + rad * Math.sin(angle));
        }
        ctx.closePath();
        break;
      }
      case 'octagon': {
        const sides = 8;
        for (let i = 0; i < sides; i++) {
          const angle = (i * 2 * Math.PI) / sides - Math.PI / 8;
          if (i === 0) ctx.moveTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
          else ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
        }
        ctx.closePath();
        break;
      }
      default:
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();

    const imgData = ctx.getImageData(0, 0, size, size);
    map.addImage(iconName, { width: size, height: size, data: imgData.data });
  }

  /** Query all visible vector layers at a point */
  queryAllFeatures(point) {
    if (!this._map) return [];
    const visibleIds = this._layers
      .filter(l => l.visible && l._mlLayerIds.length > 0)
      .flatMap(l => l._mlLayerIds);
    if (!visibleIds.length) return [];
    return this._map.queryRenderedFeatures(point, { layers: visibleIds });
  }
}

export const layerManager = new LayerManager();

// ── Canvas-based marker image generator ──────────────────────────────────────

/**
 * Draw a point marker shape onto a canvas.
 * Returns the canvas element.
 */
function createMarkerCanvas(shape, size, fillColor, strokeColor, strokeWidth) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const sw = strokeWidth || 1.5;
  const r = c - sw - 1;  // inner radius, accounts for stroke bleed

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();

  switch (shape) {
    case 'square':
      ctx.rect(c - r, c - r, r * 2, r * 2);
      break;

    case 'triangle':
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r, c + r);
      ctx.lineTo(c - r, c + r);
      ctx.closePath();
      break;

    case 'diamond':
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r, c);
      ctx.lineTo(c, c + r);
      ctx.lineTo(c - r, c);
      ctx.closePath();
      break;

    case 'pentagon':
      for (let i = 0; i < 5; i++) {
        const a = (i * 2 * Math.PI / 5) - Math.PI / 2;
        i === 0 ? ctx.moveTo(c + r * Math.cos(a), c + r * Math.sin(a))
                : ctx.lineTo(c + r * Math.cos(a), c + r * Math.sin(a));
      }
      ctx.closePath();
      break;

    case 'octagon':
      for (let i = 0; i < 8; i++) {
        const a = (i * 2 * Math.PI / 8) - Math.PI / 8;
        i === 0 ? ctx.moveTo(c + r * Math.cos(a), c + r * Math.sin(a))
                : ctx.lineTo(c + r * Math.cos(a), c + r * Math.sin(a));
      }
      ctx.closePath();
      break;

    case 'star': {
      const outerR = r, innerR = r * 0.45;
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI / 5) - Math.PI / 2;
        const rad = i % 2 === 0 ? outerR : innerR;
        i === 0 ? ctx.moveTo(c + rad * Math.cos(a), c + rad * Math.sin(a))
                : ctx.lineTo(c + rad * Math.cos(a), c + rad * Math.sin(a));
      }
      ctx.closePath();
      break;
    }

    case 'cross': {
      const arm = r * 0.38;
      ctx.moveTo(c - arm, c - r); ctx.lineTo(c + arm, c - r);
      ctx.lineTo(c + arm, c - arm); ctx.lineTo(c + r, c - arm);
      ctx.lineTo(c + r, c + arm); ctx.lineTo(c + arm, c + arm);
      ctx.lineTo(c + arm, c + r); ctx.lineTo(c - arm, c + r);
      ctx.lineTo(c - arm, c + arm); ctx.lineTo(c - r, c + arm);
      ctx.lineTo(c - r, c - arm); ctx.lineTo(c - arm, c - arm);
      ctx.closePath();
      break;
    }

    case 'x': {
      // Cross rotated 45°
      const arm = r * 0.38;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(Math.PI / 4);
      ctx.moveTo(-arm, -r); ctx.lineTo(arm, -r);
      ctx.lineTo(arm, -arm); ctx.lineTo(r, -arm);
      ctx.lineTo(r, arm); ctx.lineTo(arm, arm);
      ctx.lineTo(arm, r); ctx.lineTo(-arm, r);
      ctx.lineTo(-arm, arm); ctx.lineTo(-r, arm);
      ctx.lineTo(-r, -arm); ctx.lineTo(-arm, -arm);
      ctx.closePath();
      ctx.restore();
      break;
    }

    default: // circle
      ctx.arc(c, c, r, 0, Math.PI * 2);
  }

  ctx.fillStyle = fillColor;
  ctx.fill();

  if (sw > 0 && strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = sw;
    ctx.stroke();
  }

  return canvas;
}
