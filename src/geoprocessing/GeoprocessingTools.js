import * as turf from '@turf/turf';
import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { uid } from '../utils/uid.js';

/**
 * GeoprocessingTools — vector analysis using Turf.js
 */
export class GeoprocessingTools {

  /**
   * Buffer features by a given distance
   * @param {string} layerId
   * @param {number} distance
   * @param {string} units - 'meters'|'kilometers'|'miles'|'feet'
   */
  async buffer(layerId, distance, units = 'kilometers') {
    const layer = this._getLayer(layerId);
    const result = turf.buffer(layer.data, distance, { units });
    return this._addResult(result, `${layer.name} — Buffer (${distance} ${units})`, 'Polygon');
  }

  /**
   * Dissolve polygons by a field (or all into one)
   */
  async dissolve(layerId, propertyName = null) {
    const layer = this._getLayer(layerId);
    let result;
    if (propertyName) {
      result = turf.dissolve(layer.data, { propertyName });
    } else {
      // Dissolve all into single feature using union
      const polys = layer.data.features.filter(f =>
        f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
      );
      if (polys.length === 0) throw new Error('No polygon features to dissolve');
      let merged = polys[0];
      for (let i = 1; i < polys.length; i++) {
        try { merged = turf.union(turf.featureCollection([merged, polys[i]])); } catch(e) {}
      }
      result = turf.featureCollection([merged]);
    }
    return this._addResult(result, `${layer.name} — Dissolved`, 'Polygon');
  }

  /**
   * Clip layer A by the extent of layer B
   */
  async clip(layerIdA, layerIdB) {
    const layerA = this._getLayer(layerIdA);
    const layerB = this._getLayer(layerIdB);

    // Get bounding polygon of layer B
    const mask = turf.convex(layerB.data) || turf.bboxPolygon(turf.bbox(layerB.data));

    const clipped = [];
    for (const f of layerA.data.features) {
      try {
        const result = turf.intersect(turf.featureCollection([f, mask]));
        if (result) clipped.push(result);
      } catch(e) {}
    }

    const fc = turf.featureCollection(clipped);
    return this._addResult(fc, `${layerA.name} — Clipped`, layerA.geometryType);
  }

  /**
   * Intersect two layers (features that overlap)
   */
  async intersect(layerIdA, layerIdB) {
    const layerA = this._getLayer(layerIdA);
    const layerB = this._getLayer(layerIdB);

    const results = [];
    for (const fA of layerA.data.features) {
      for (const fB of layerB.data.features) {
        try {
          const inter = turf.intersect(turf.featureCollection([fA, fB]));
          if (inter) {
            inter.properties = { ...fA.properties, ...fB.properties };
            results.push(inter);
          }
        } catch(e) {}
      }
    }

    const fc = turf.featureCollection(results);
    return this._addResult(fc, `${layerA.name} ∩ ${layerB.name}`, 'Polygon');
  }

  /**
   * Union two polygon layers
   */
  async union(layerIdA, layerIdB) {
    const layerA = this._getLayer(layerIdA);
    const layerB = this._getLayer(layerIdB);
    const combined = turf.featureCollection([
      ...layerA.data.features,
      ...layerB.data.features,
    ]);
    const result = turf.dissolve(combined);
    return this._addResult(result, `${layerA.name} ∪ ${layerB.name}`, 'Polygon');
  }

  /**
   * Difference — features in A not in B
   */
  async difference(layerIdA, layerIdB) {
    const layerA = this._getLayer(layerIdA);
    const layerB = this._getLayer(layerIdB);

    const bUnion = this._unionAll(layerB.data.features);
    const results = [];

    for (const fA of layerA.data.features) {
      try {
        const diff = turf.difference(turf.featureCollection([fA, bUnion]));
        if (diff) results.push(diff);
      } catch(e) {}
    }

    const fc = turf.featureCollection(results);
    return this._addResult(fc, `${layerA.name} − ${layerB.name}`, 'Polygon');
  }

  /**
   * Convex hull of a layer
   */
  async convexHull(layerId) {
    const layer = this._getLayer(layerId);
    const hull = turf.convex(layer.data);
    if (!hull) throw new Error('Could not compute convex hull');
    return this._addResult(turf.featureCollection([hull]), `${layer.name} — Convex Hull`, 'Polygon');
  }

  /**
   * Centroid of each feature
   */
  async centroid(layerId) {
    const layer = this._getLayer(layerId);
    const centroids = layer.data.features
      .filter(f => f.geometry)
      .map(f => {
        const c = turf.centroid(f);
        c.properties = { ...f.properties };
        return c;
      });
    return this._addResult(turf.featureCollection(centroids), `${layer.name} — Centroids`, 'Point');
  }

  /**
   * Simplify geometries using Douglas-Peucker
   */
  async simplify(layerId, tolerance = 0.001, highQuality = false) {
    const layer = this._getLayer(layerId);
    const simplified = turf.simplify(layer.data, { tolerance, highQuality });
    return this._addResult(simplified, `${layer.name} — Simplified (${tolerance})`, layer.geometryType);
  }

  /**
   * Calculate bounding box rectangle
   */
  async bboxPolygon(layerId) {
    const layer = this._getLayer(layerId);
    const box = turf.bboxPolygon(turf.bbox(layer.data));
    return this._addResult(turf.featureCollection([box]), `${layer.name} — BBox`, 'Polygon');
  }

  /**
   * Voronoi diagram from point layer
   */
  async voronoi(layerId) {
    const layer = this._getLayer(layerId);
    const points = layer.data.features.filter(f => f.geometry?.type === 'Point');
    if (points.length < 3) throw new Error('Need at least 3 points for Voronoi');
    const bbox = turf.bbox(layer.data);
    const voronoiPolys = turf.voronoi(turf.featureCollection(points), { bbox });
    return this._addResult(voronoiPolys, `${layer.name} — Voronoi`, 'Polygon');
  }

  /**
   * Spatial join: add attributes from polygons to points
   */
  async spatialJoin(pointLayerId, polyLayerId) {
    const pointLayer = this._getLayer(pointLayerId);
    const polyLayer = this._getLayer(polyLayerId);

    const joined = pointLayer.data.features.map(pt => {
      const containing = polyLayer.data.features.find(poly => {
        try { return turf.booleanPointInPolygon(pt, poly); } catch(e) { return false; }
      });
      return {
        ...pt,
        properties: { ...pt.properties, ...(containing?.properties || {}) },
      };
    });

    const fc = turf.featureCollection(joined);
    return this._addResult(fc, `${pointLayer.name} + ${polyLayer.name} (Join)`, 'Point');
  }

  /**
   * Calculate area for each polygon feature and add as attribute
   */
  async calculateArea(layerId, units = 'kilometers') {
    const layer = this._getLayer(layerId);
    const features = layer.data.features.map(f => {
      if (f.geometry?.type !== 'Polygon' && f.geometry?.type !== 'MultiPolygon') return f;
      const area = turf.area(f);
      const areaConverted = units === 'meters' ? area
        : units === 'kilometers' ? area / 1e6
        : units === 'hectares' ? area / 1e4
        : area / 1e6;
      return {
        ...f,
        properties: { ...f.properties, [`area_${units}`]: parseFloat(areaConverted.toFixed(4)) },
      };
    });
    const fc = turf.featureCollection(features);
    layerManager.updateData(layerId, fc);
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Area calculated for ${layer.name}` });
    return layer;
  }

  /**
   * Calculate length for each line feature
   */
  async calculateLength(layerId, units = 'kilometers') {
    const layer = this._getLayer(layerId);
    const features = layer.data.features.map(f => {
      if (f.geometry?.type !== 'LineString' && f.geometry?.type !== 'MultiLineString') return f;
      const len = turf.length(f, { units });
      return {
        ...f,
        properties: { ...f.properties, [`length_${units}`]: parseFloat(len.toFixed(4)) },
      };
    });
    const fc = turf.featureCollection(features);
    layerManager.updateData(layerId, fc);
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Length calculated for ${layer.name}` });
    return layer;
  }

  /**
   * Merge multiple layers into one
   */
  async mergeLayers(layerIds) {
    const allFeatures = [];
    const names = [];
    for (const id of layerIds) {
      const layer = layerManager.layers.find(l => l.id === id);
      if (layer?.data) {
        allFeatures.push(...layer.data.features);
        names.push(layer.name);
      }
    }
    const fc = turf.featureCollection(allFeatures);
    return this._addResult(fc, `Merged: ${names.slice(0, 3).join(', ')}`, null);
  }

  /**
   * Spatial filter: keep features within polygon
   */
  async spatialFilter(layerId, polygonLayerId) {
    const layer = this._getLayer(layerId);
    const polyLayer = this._getLayer(polygonLayerId);
    const mask = this._unionAll(polyLayer.data.features);

    const filtered = layer.data.features.filter(f => {
      if (!f.geometry) return false;
      try {
        if (f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint') {
          const pt = f.geometry.type === 'Point' ? f : turf.centroid(f);
          return turf.booleanPointInPolygon(pt, mask);
        }
        return turf.booleanIntersects(f, mask);
      } catch(e) { return false; }
    });

    const fc = turf.featureCollection(filtered);
    return this._addResult(fc, `${layer.name} — Filtered`, layer.geometryType);
  }

  /**
   * Line to polygon (close lines and convert)
   */
  async lineToPolygon(layerId) {
    const layer = this._getLayer(layerId);
    const polys = layer.data.features
      .filter(f => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString')
      .map(f => {
        try {
          const p = turf.lineToPolygon(f);
          p.properties = { ...f.properties };
          return p;
        } catch(e) { return null; }
      })
      .filter(Boolean);

    return this._addResult(turf.featureCollection(polys), `${layer.name} — Polygonized`, 'Polygon');
  }

  // ---- Helpers ----
  _getLayer(id) {
    const layer = layerManager.layers.find(l => l.id === id);
    if (!layer) throw new Error(`Layer not found: ${id}`);
    if (layer.type !== 'vector' && layer.type !== 'esri-feature') throw new Error(`Layer is not a vector layer: ${layer.name}`);
    return layer;
  }

  async _addResult(fc, name, geomType) {
    const layer = await layerManager.addLayer({
      name,
      type: 'vector',
      data: fc,
      geometryType: geomType || detectType(fc),
      sourceFormat: 'geoprocessing',
    });
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Created: ${name} (${fc.features.length} features)` });
    return layer;
  }

  _unionAll(features) {
    const polys = features.filter(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');
    if (!polys.length) return features[0];
    let result = polys[0];
    for (let i = 1; i < polys.length; i++) {
      try { result = turf.union(turf.featureCollection([result, polys[i]])); } catch(e) {}
    }
    return result;
  }

  /**
   * Measure distance between two points (for measure tool)
   */
  measureDistance(from, to, units = 'kilometers') {
    return turf.distance(turf.point(from), turf.point(to), { units });
  }

  /**
   * Measure area of a polygon (for measure tool)
   */
  measureArea(coordinates) {
    const poly = turf.polygon(coordinates);
    return turf.area(poly); // square meters
  }
}

function detectType(fc) {
  for (const f of fc.features || []) {
    const t = f.geometry?.type;
    if (t === 'Point' || t === 'MultiPoint') return 'Point';
    if (t === 'LineString' || t === 'MultiLineString') return 'LineString';
    if (t === 'Polygon' || t === 'MultiPolygon') return 'Polygon';
  }
  return 'Point';
}

export const gpTools = new GeoprocessingTools();
