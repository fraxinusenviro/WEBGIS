import MapboxDraw from '@mapbox/mapbox-gl-draw';
import * as turf from '@turf/turf';
import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager, detectGeometryType } from '../layers/LayerManager.js';
import { uid } from '../utils/uid.js';

/**
 * EditingManager — manages vector feature creation and editing via MapLibre GL Draw
 */
export class EditingManager {
  constructor() {
    this._draw = null;
    this._map = null;
    this._currentMode = 'simple_select';
    this._editLayerId = null; // which layer we're editing
    this._history = []; // undo stack
    this._redoStack = [];
    this._measuring = false;
    this._measurePoints = [];

    bus.on(EVENTS.MAP_READY, ({ map }) => {
      this._map = map;
      this._initDraw();
    });
  }

  _initDraw() {
    this._draw = new MapboxDraw({
      displayControlsDefault: false,
      userProperties: true,
      styles: drawStyles(),
    });
    this._map.addControl(this._draw, 'top-left');

    // Listen for draw events
    this._map.on('draw.create', (e) => this._onDrawCreate(e));
    this._map.on('draw.update', (e) => this._onDrawUpdate(e));
    this._map.on('draw.delete', (e) => this._onDrawDelete(e));
    this._map.on('draw.selectionchange', (e) => this._onSelectionChange(e));
  }

  // ---- Tool activation ----
  setMode(mode) {
    if (!this._draw) return;
    this._currentMode = mode;

    switch(mode) {
      case 'select':
      case 'simple_select':
        this._draw.changeMode('simple_select');
        this._map.getCanvas().style.cursor = '';
        bus.emit(EVENTS.EDIT_MODE, { mode: 'select' });
        break;
      case 'draw_point':
        this._draw.changeMode('draw_point');
        this._map.getCanvas().style.cursor = 'crosshair';
        bus.emit(EVENTS.EDIT_MODE, { mode: 'draw_point' });
        break;
      case 'draw_line_string':
        this._draw.changeMode('draw_line_string');
        this._map.getCanvas().style.cursor = 'crosshair';
        bus.emit(EVENTS.EDIT_MODE, { mode: 'draw_line_string' });
        break;
      case 'draw_polygon':
        this._draw.changeMode('draw_polygon');
        this._map.getCanvas().style.cursor = 'crosshair';
        bus.emit(EVENTS.EDIT_MODE, { mode: 'draw_polygon' });
        break;
      case 'direct_select':
        const selected = this._draw.getSelectedIds();
        if (selected.length) {
          this._draw.changeMode('direct_select', { featureId: selected[0] });
        }
        bus.emit(EVENTS.EDIT_MODE, { mode: 'direct_select' });
        break;
      case 'delete':
        this.deleteSelected();
        break;
    }
  }

  // ---- Assign draw output to a layer ----
  /**
   * Set which layer new features will be added to
   * Creates a new scratch layer if layerId is null
   */
  setEditLayer(layerId, loadExisting = true) {
    this._editLayerId = layerId || null;
    if (layerId && loadExisting) {
      const layer = layerManager.layers.find(l => l.id === layerId);
      if (layer?.data) {
        this._draw.set(layer.data);
      }
    }
  }

  clearEditLayer() {
    this._editLayerId = null;
    this._draw.deleteAll();
  }

  // ---- Geometry attribute calculation ----
  _calcGeomAttributes(feature) {
    const geom = feature.geometry;
    if (!geom) return feature;
    const props = { ...(feature.properties || {}) };
    const type = geom.type;

    if (type === 'LineString' || type === 'MultiLineString') {
      const lengthKm = turf.length(feature, { units: 'kilometers' });
      props.length_km = Math.round(lengthKm * 100) / 100;
      props.length_m = Math.round(lengthKm * 1000 * 100) / 100;
    } else if (type === 'Polygon' || type === 'MultiPolygon') {
      const areaM2 = turf.area(feature);
      props.area_m2 = Math.round(areaM2 * 100) / 100;
      props.area_ha = Math.round((areaM2 / 10000) * 100) / 100;
      // Perimeter: length of outer ring as LineString
      try {
        const coords = type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
        const ring = turf.lineString(coords);
        const perimKm = turf.length(ring, { units: 'kilometers' });
        props.perimeter_m = Math.round(perimKm * 1000 * 100) / 100;
      } catch(e) {}
    }

    return { ...feature, properties: props };
  }

  // ---- Schema attribute population ----
  _applySchema(feature, layer) {
    if (!layer?.metadata?.schema?.length) return feature;
    const schema = layer.metadata.schema;
    const props = { ...(feature.properties || {}) };

    for (const field of schema) {
      if (field.isUUID) {
        if (!props[field.name]) props[field.name] = crypto.randomUUID();
      } else if (props[field.name] === undefined || props[field.name] === null) {
        props[field.name] = field.defaultValue !== undefined ? field.defaultValue : '';
      }
    }

    return { ...feature, properties: props };
  }

  // ---- Show schema dialog for required non-auto fields ----
  _showSchemaDialog(feature, layer, onComplete) {
    const schema = layer?.metadata?.schema;
    if (!schema?.length) { onComplete(feature); return; }

    const requiredFields = schema.filter(f => f.required && !f.isUUID && (f.defaultValue === undefined || f.defaultValue === ''));
    if (!requiredFields.length) { onComplete(feature); return; }

    // Dynamic import to avoid circular deps
    import('../ui/Modal.js').then(({ openModal, closeModal }) => {
      const content = document.createElement('div');
      content.innerHTML = `
        <p style="font-size:12px;color:var(--text-secondary);margin-bottom:10px">Fill in required fields for this feature:</p>
        ${requiredFields.map(f => `
          <div class="form-group">
            <label class="form-label">${f.name} (${f.type})</label>
            <input class="form-input" type="${f.type === 'Number' || f.type === 'Integer' ? 'number' : 'text'}" id="schema-field-${f.name}" placeholder="${f.name}">
          </div>
        `).join('')}
      `;
      openModal({
        title: `New Feature — ${layer.name}`,
        content,
        footer: `<button class="btn btn-ghost" id="schema-skip">Skip</button><button class="btn btn-primary" id="schema-ok">OK</button>`,
        width: 360,
      });
      const finish = () => {
        const props = { ...(feature.properties || {}) };
        for (const f of requiredFields) {
          const el = document.querySelector(`#schema-field-${f.name}`);
          if (el?.value) {
            props[f.name] = (f.type === 'Number' || f.type === 'Integer') ? Number(el.value) : el.value;
          }
        }
        closeModal();
        onComplete({ ...feature, properties: props });
      };
      document.querySelector('#schema-ok')?.addEventListener('click', finish);
      document.querySelector('#schema-skip')?.addEventListener('click', () => { closeModal(); onComplete(feature); });
    }).catch(() => onComplete(feature));
  }

  // ---- Draw event handlers ----
  async _onDrawCreate(e) {
    const features = e.features;
    if (!features.length) return;

    this._pushHistory('create', features);

    // Auto-calculate geometry attributes
    const enrichedFeatures = features.map(f => this._calcGeomAttributes(f));

    if (this._editLayerId) {
      // Add to existing layer
      const layer = layerManager.layers.find(l => l.id === this._editLayerId);
      if (layer?.data) {
        // Apply schema defaults/UUID first
        const schemaFeatures = enrichedFeatures.map(f => this._applySchema(f, layer));

        const addToLayer = (finalFeatures) => {
          const newData = {
            ...layer.data,
            features: [
              ...layer.data.features,
              ...finalFeatures.map(f => ({ ...f, id: undefined, properties: f.properties || {} })),
            ],
          };
          layerManager.updateData(this._editLayerId, newData);
          bus.emit(EVENTS.EDIT_FEATURE_ADDED, { features: finalFeatures });
          if (finalFeatures[0]?.geometry?.type === 'Point') {
            this.setMode('simple_select');
          }
        };

        // Show schema dialog for required fields if layer has schema
        if (layer.metadata?.schema?.length && schemaFeatures.length === 1) {
          this._showSchemaDialog(schemaFeatures[0], layer, (finalFeature) => {
            addToLayer([finalFeature]);
          });
        } else {
          addToLayer(schemaFeatures);
        }
        return;
      }
    } else {
      // Create new layer from these features
      const geomType = detectGeometryType({ type: 'FeatureCollection', features: enrichedFeatures });
      const newLayer = await layerManager.addLayer({
        name: `New ${geomType} Layer`,
        type: 'vector',
        data: { type: 'FeatureCollection', features: enrichedFeatures.map(f => ({ ...f, id: undefined })) },
        geometryType: geomType,
        sourceFormat: 'drawn',
      });
      this._editLayerId = newLayer.id;
    }

    bus.emit(EVENTS.EDIT_FEATURE_ADDED, { features: enrichedFeatures });

    // Return to select mode after point/single feature
    if (enrichedFeatures[0]?.geometry?.type === 'Point') {
      this.setMode('simple_select');
    }
  }

  _onDrawUpdate(e) {
    const features = e.features;
    if (!features.length) return;

    this._pushHistory('update', features);

    // Auto-calculate geometry attributes on update
    const enrichedFeatures = features.map(f => this._calcGeomAttributes(f));

    if (this._editLayerId) {
      const layer = layerManager.layers.find(l => l.id === this._editLayerId);
      if (layer?.data) {
        const updatedIds = new Set(enrichedFeatures.map(f => f.id));
        const newData = {
          ...layer.data,
          features: layer.data.features.map(f =>
            updatedIds.has(f.id) ? enrichedFeatures.find(uf => uf.id === f.id) : f
          ),
        };
        layerManager.updateData(this._editLayerId, newData);
      }
    }
    bus.emit(EVENTS.EDIT_FEATURE_UPDATED, { features: enrichedFeatures });
  }

  _onDrawDelete(e) {
    const features = e.features;
    if (!features.length) return;

    this._pushHistory('delete', features);

    if (this._editLayerId) {
      const layer = layerManager.layers.find(l => l.id === this._editLayerId);
      if (layer?.data) {
        const deletedIds = new Set(features.map(f => f.id));
        const newData = {
          ...layer.data,
          features: layer.data.features.filter(f => !deletedIds.has(f.id)),
        };
        layerManager.updateData(this._editLayerId, newData);
      }
    }
    bus.emit(EVENTS.EDIT_FEATURE_DELETED, { features });
  }

  _onSelectionChange(e) {
    const selected = e.features;
    if (selected.length === 1) {
      bus.emit('edit:selected', { feature: selected[0] });
    }
  }

  // ---- Delete selected ----
  deleteSelected() {
    if (!this._draw) return;
    const selected = this._draw.getSelected();
    if (selected.features.length > 0) {
      this._draw.trash();
    }
  }

  // ---- Commit draw session to layer ----
  commitToLayer(layerId) {
    if (!this._draw) return;
    const all = this._draw.getAll();
    if (!all.features.length) return;

    const layer = layerManager.layers.find(l => l.id === layerId);
    if (!layer) return;

    const existing = layer.data?.features || [];
    const drawFeatureIds = new Set(all.features.map(f => f.id));

    layerManager.updateData(layerId, {
      type: 'FeatureCollection',
      features: [...existing.filter(f => !drawFeatureIds.has(f.id)), ...all.features],
    });

    this._draw.deleteAll();
    bus.emit(EVENTS.EDIT_COMMIT, { layerId });
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Changes committed to layer' });
  }

  // ---- Undo / Redo ----
  _pushHistory(type, features) {
    this._history.push({ type, features: JSON.parse(JSON.stringify(features)) });
    this._redoStack = [];
    if (this._history.length > 50) this._history.shift();
  }

  undo() {
    // Simplified undo: restore from draw state
    if (!this._draw) return;
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Undo: use Ctrl+Z for browser undo in draw mode' });
  }

  // ---- Measure tool ----
  startMeasure() {
    this._measuring = true;
    this._measurePoints = [];
    this._map.getCanvas().style.cursor = 'crosshair';
    this._measureClickHandler = (e) => this._onMeasureClick(e);
    this._map.on('click', this._measureClickHandler);
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Click to add measurement points. Double-click to finish.' });
  }

  stopMeasure() {
    this._measuring = false;
    this._measurePoints = [];
    this._map.getCanvas().style.cursor = '';
    if (this._measureClickHandler) {
      this._map.off('click', this._measureClickHandler);
    }
    // Remove measure overlay
    if (this._map.getSource('measure-src')) {
      this._map.removeLayer('measure-line');
      this._map.removeLayer('measure-points');
      this._map.removeSource('measure-src');
    }
  }

  _onMeasureClick(e) {
    const { lng, lat } = e.lngLat;
    this._measurePoints.push([lng, lat]);
    this._updateMeasureDisplay();
  }

  _updateMeasureDisplay() {
    const pts = this._measurePoints;
    if (!pts.length) return;

    const geojson = {
      type: 'FeatureCollection',
      features: [
        pts.length >= 2 ? {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: pts },
          properties: {},
        } : null,
        ...pts.map(p => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: p },
          properties: {},
        })),
      ].filter(Boolean),
    };

    if (!this._map.getSource('measure-src')) {
      this._map.addSource('measure-src', { type: 'geojson', data: geojson });
      this._map.addLayer({
        id: 'measure-line',
        type: 'line',
        source: 'measure-src',
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#fbbf24', 'line-width': 2, 'line-dasharray': [4, 2] },
      });
      this._map.addLayer({
        id: 'measure-points',
        type: 'circle',
        source: 'measure-src',
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-color': '#fbbf24', 'circle-radius': 5, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
      });
    } else {
      this._map.getSource('measure-src').setData(geojson);
    }

    if (pts.length >= 2) {
      let totalDist = 0;
      for (let i = 1; i < pts.length; i++) {
        totalDist += turf.distance(turf.point(pts[i-1]), turf.point(pts[i]), { units: 'kilometers' });
      }
      bus.emit(EVENTS.SHOW_TOAST, {
        type: 'info',
        message: `Distance: ${totalDist.toFixed(3)} km`,
        duration: 3000,
      });
    }
  }

  // ---- Identify tool ----
  enableIdentify() {
    this._identifyHandler = (e) => {
      const features = layerManager.queryAllFeatures([e.point.x, e.point.y]);
      if (features.length > 0) {
        bus.emit(EVENTS.SHOW_IDENTIFY, {
          lngLat: [e.lngLat.lng, e.lngLat.lat],
          features,
          screenPoint: { x: e.point.x, y: e.point.y },
        });
      }
    };
    this._map.on('click', this._identifyHandler);
  }

  disableIdentify() {
    if (this._identifyHandler) {
      this._map.off('click', this._identifyHandler);
      this._identifyHandler = null;
    }
  }

  getDraw() { return this._draw; }
  getCurrentMode() { return this._currentMode; }
  getEditLayerId() { return this._editLayerId; }
}

// ---- Draw styles (dark theme) ----
function drawStyles() {
  return [
    // Line
    {
      id: 'gl-draw-line',
      type: 'line',
      filter: ['all', ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#4ade80', 'line-dasharray': [0.2, 2], 'line-width': 2 },
    },
    {
      id: 'gl-draw-line-active',
      type: 'line',
      filter: ['all', ['==', '$type', 'LineString'], ['==', 'active', 'true']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#4ade80', 'line-width': 2.5 },
    },
    // Polygon fill
    {
      id: 'gl-draw-polygon-fill',
      type: 'fill',
      filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
      paint: { 'fill-color': '#4ade80', 'fill-outline-color': '#4ade80', 'fill-opacity': 0.15 },
    },
    {
      id: 'gl-draw-polygon-fill-active',
      type: 'fill',
      filter: ['all', ['==', '$type', 'Polygon'], ['==', 'active', 'true']],
      paint: { 'fill-color': '#4ade80', 'fill-outline-color': '#4ade80', 'fill-opacity': 0.25 },
    },
    // Polygon stroke
    {
      id: 'gl-draw-polygon-stroke',
      type: 'line',
      filter: ['all', ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#4ade80', 'line-width': 2 },
    },
    // Vertices
    {
      id: 'gl-draw-polygon-midpoint',
      type: 'circle',
      filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
      paint: { 'circle-radius': 4, 'circle-color': '#22c55e' },
    },
    {
      id: 'gl-draw-polygon-and-line-vertex-stroke-inactive',
      type: 'circle',
      filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
      paint: { 'circle-radius': 7, 'circle-color': '#fff' },
    },
    {
      id: 'gl-draw-polygon-and-line-vertex-inactive',
      type: 'circle',
      filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
      paint: { 'circle-radius': 5, 'circle-color': '#4ade80' },
    },
    // Point
    {
      id: 'gl-draw-point-point-stroke-inactive',
      type: 'circle',
      filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
      paint: { 'circle-radius': 7, 'circle-opacity': 1, 'circle-color': '#fff' },
    },
    {
      id: 'gl-draw-point-inactive',
      type: 'circle',
      filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
      paint: { 'circle-radius': 5, 'circle-color': '#4ade80' },
    },
    {
      id: 'gl-draw-point-stroke-active',
      type: 'circle',
      filter: ['all', ['==', '$type', 'Point'], ['==', 'active', 'true'], ['!=', 'meta', 'midpoint']],
      paint: { 'circle-radius': 9, 'circle-color': '#fff' },
    },
    {
      id: 'gl-draw-point-active',
      type: 'circle',
      filter: ['all', ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint'], ['==', 'active', 'true']],
      paint: { 'circle-radius': 7, 'circle-color': '#4ade80' },
    },
    // Static
    {
      id: 'gl-draw-polygon-fill-static',
      type: 'fill',
      filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
      paint: { 'fill-color': '#6b7280', 'fill-outline-color': '#6b7280', 'fill-opacity': 0.1 },
    },
    {
      id: 'gl-draw-polygon-stroke-static',
      type: 'line',
      filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Polygon']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#6b7280', 'line-width': 2 },
    },
    {
      id: 'gl-draw-line-static',
      type: 'line',
      filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'LineString']],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#6b7280', 'line-width': 2 },
    },
    {
      id: 'gl-draw-point-static',
      type: 'circle',
      filter: ['all', ['==', 'mode', 'static'], ['==', '$type', 'Point']],
      paint: { 'circle-radius': 5, 'circle-color': '#6b7280' },
    },
  ];
}

export const editingManager = new EditingManager();
