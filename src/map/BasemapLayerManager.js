import { BASEMAPS } from './BasemapManager.js';
import { bus, EVENTS } from '../utils/EventBus.js';

export const BM_EVENTS = {
  ADDED: 'bm:added',
  REMOVED: 'bm:removed',
  UPDATED: 'bm:updated',
  ORDER: 'bm:order',
};

/**
 * BasemapLayerManager — manages a stack of basemap raster layers directly
 * on the MapLibre map, independent of LayerManager. Always rendered below
 * user vector/raster layers.
 *
 * Supports hybrid basemaps (e.g. ESRI Imagery Hybrid) that have a second
 * tile overlay layer (labels) stored in entry.overlayLayerId.
 */
export class BasemapLayerManager {
  constructor() {
    this._map = null;
    this._stack = [];

    bus.on(EVENTS.MAP_READY, ({ map }) => {
      this._map = map;
      for (const entry of this._stack) {
        if (!this._map.getSource(entry.sourceId)) {
          this._renderEntry(entry);
        }
      }
    });
  }

  get stack() { return [...this._stack]; }

  /** Add a basemap from preset id */
  addBasemap(presetId, opts = {}) {
    if (presetId === 'none') return null;
    const preset = BASEMAPS[presetId];
    if (!preset) return null;

    // Pick first source for the base tile layer
    const srcObj = Object.values(preset.style.sources || {})[0];
    if (!srcObj?.tiles) return null;

    const uid = `bm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      uid,
      presetId,
      name: preset.name,
      sourceId: `bm-src-${uid}`,
      layerId: `bm-lyr-${uid}`,
      tiles: srcObj.tiles,
      tileSize: srcObj.tileSize || 256,
      maxzoom: srcObj.maxzoom || 19,
      opacity: opts.opacity !== undefined ? opts.opacity : 1.0,
      saturation: opts.saturation !== undefined ? opts.saturation : 0,
      visible: opts.visible !== undefined ? opts.visible : true,
      // Hybrid overlay (e.g. ESRI labels on top of imagery)
      overlayTiles: preset.overlayTiles || null,
      overlayMaxzoom: preset.overlayMaxzoom || 19,
      overlaySourceId: null,
      overlayLayerId: null,
    };

    if (entry.overlayTiles) {
      entry.overlaySourceId = `bm-src-ov-${uid}`;
      entry.overlayLayerId = `bm-lyr-ov-${uid}`;
    }

    this._stack.push(entry);
    if (this._map) this._renderEntry(entry);
    bus.emit(BM_EVENTS.ADDED, { ...entry });
    return entry;
  }

  /** Remove a basemap by uid */
  removeBasemap(uid) {
    const idx = this._stack.findIndex(b => b.uid === uid);
    if (idx < 0) return;
    const entry = this._stack[idx];
    this._stack.splice(idx, 1);
    this._removeFromMap(entry);
    bus.emit(BM_EVENTS.REMOVED, { uid });
  }

  setOpacity(uid, val) {
    const entry = this._stack.find(b => b.uid === uid);
    if (!entry) return;
    entry.opacity = val;
    if (this._map?.getLayer(entry.layerId)) {
      this._map.setPaintProperty(entry.layerId, 'raster-opacity', entry.visible ? val : 0);
    }
    if (entry.overlayLayerId && this._map?.getLayer(entry.overlayLayerId)) {
      this._map.setPaintProperty(entry.overlayLayerId, 'raster-opacity', entry.visible ? val : 0);
    }
    bus.emit(BM_EVENTS.UPDATED, { uid });
  }

  setSaturation(uid, val) {
    const entry = this._stack.find(b => b.uid === uid);
    if (!entry) return;
    entry.saturation = val;
    if (this._map?.getLayer(entry.layerId)) {
      this._map.setPaintProperty(entry.layerId, 'raster-saturation', val);
    }
    if (entry.overlayLayerId && this._map?.getLayer(entry.overlayLayerId)) {
      this._map.setPaintProperty(entry.overlayLayerId, 'raster-saturation', val);
    }
    bus.emit(BM_EVENTS.UPDATED, { uid });
  }

  toggleVisible(uid) {
    const entry = this._stack.find(b => b.uid === uid);
    if (!entry) return;
    entry.visible = !entry.visible;
    if (this._map?.getLayer(entry.layerId)) {
      this._map.setPaintProperty(entry.layerId, 'raster-opacity', entry.visible ? entry.opacity : 0);
    }
    if (entry.overlayLayerId && this._map?.getLayer(entry.overlayLayerId)) {
      this._map.setPaintProperty(entry.overlayLayerId, 'raster-opacity', entry.visible ? entry.opacity : 0);
    }
    bus.emit(BM_EVENTS.UPDATED, { uid });
  }

  /** Move up in TOC = higher render order = higher index in _stack */
  moveUp(uid) {
    const idx = this._stack.findIndex(b => b.uid === uid);
    if (idx < 0 || idx >= this._stack.length - 1) return;
    [this._stack[idx], this._stack[idx + 1]] = [this._stack[idx + 1], this._stack[idx]];
    this._reorderOnMap();
    bus.emit(BM_EVENTS.ORDER, null);
  }

  /** Move down in TOC = lower render order = lower index in _stack */
  moveDown(uid) {
    const idx = this._stack.findIndex(b => b.uid === uid);
    if (idx <= 0) return;
    [this._stack[idx - 1], this._stack[idx]] = [this._stack[idx], this._stack[idx - 1]];
    this._reorderOnMap();
    bus.emit(BM_EVENTS.ORDER, null);
  }

  _renderEntry(entry) {
    if (!this._map) return;
    try {
      const before = this._getFirstUserLayerId();

      // Base raster layer
      this._map.addSource(entry.sourceId, {
        type: 'raster',
        tiles: entry.tiles,
        tileSize: entry.tileSize,
        maxzoom: entry.maxzoom,
      });
      this._map.addLayer({
        id: entry.layerId,
        type: 'raster',
        source: entry.sourceId,
        paint: {
          'raster-opacity': entry.visible ? entry.opacity : 0,
          'raster-saturation': entry.saturation,
        },
      }, before || undefined);

      // Hybrid overlay layer (labels on top of imagery)
      if (entry.overlayTiles && entry.overlaySourceId && entry.overlayLayerId) {
        this._map.addSource(entry.overlaySourceId, {
          type: 'raster',
          tiles: entry.overlayTiles,
          tileSize: 256,
          maxzoom: entry.overlayMaxzoom,
        });
        this._map.addLayer({
          id: entry.overlayLayerId,
          type: 'raster',
          source: entry.overlaySourceId,
          paint: {
            'raster-opacity': entry.visible ? entry.opacity : 0,
            'raster-saturation': entry.saturation,
          },
        }, before || undefined);
      }
    } catch (e) {
      console.error('Failed to render basemap:', e);
    }
  }

  _removeFromMap(entry) {
    if (!this._map) return;
    try {
      if (entry.overlayLayerId && this._map.getLayer(entry.overlayLayerId)) {
        this._map.removeLayer(entry.overlayLayerId);
      }
      if (entry.overlaySourceId && this._map.getSource(entry.overlaySourceId)) {
        this._map.removeSource(entry.overlaySourceId);
      }
      if (this._map.getLayer(entry.layerId)) this._map.removeLayer(entry.layerId);
      if (this._map.getSource(entry.sourceId)) this._map.removeSource(entry.sourceId);
    } catch (e) {}
  }

  /** Returns first non-basemap, non-draw layer id (to insert basemaps before it) */
  _getFirstUserLayerId() {
    const layers = this._map?.getStyle()?.layers || [];
    for (const l of layers) {
      if (!l.id.startsWith('bm-lyr-') && !l.id.startsWith('gl-draw-')) {
        return l.id;
      }
    }
    return null;
  }

  _reorderOnMap() {
    if (!this._map) return;
    for (let i = 0; i < this._stack.length; i++) {
      const entry = this._stack[i];
      const nextBm = this._stack[i + 1];
      const beforeId = nextBm?.layerId || this._getFirstUserLayerId() || undefined;
      try {
        if (this._map.getLayer(entry.layerId)) {
          this._map.moveLayer(entry.layerId, beforeId);
        }
        if (entry.overlayLayerId && this._map.getLayer(entry.overlayLayerId)) {
          this._map.moveLayer(entry.overlayLayerId, beforeId);
        }
      } catch (e) {}
    }
  }

  serialize() {
    return this._stack.map(b => ({
      presetId: b.presetId,
      opacity: b.opacity,
      saturation: b.saturation,
      visible: b.visible,
    }));
  }

  restore(saved) {
    for (const b of [...this._stack]) this.removeBasemap(b.uid);
    for (const s of (saved || [])) {
      const entry = this.addBasemap(s.presetId, {
        opacity: s.opacity,
        saturation: s.saturation,
        visible: s.visible,
      });
    }
  }
}

export const basemapLayerManager = new BasemapLayerManager();
