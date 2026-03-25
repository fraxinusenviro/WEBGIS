/**
 * FeltManager — Felt Style Language (FSL) conversion and Felt API upload.
 *
 * FSL reference: https://felt.com/blog/felt-style-language
 * Felt API v2:   https://feltmaps.notion.site/Felt-Public-API
 *
 * Compatible with the GPS2026felt upload pattern:
 *   POST /maps/{mapId}/layers  →  multipart/form-data with GeoJSON file + optional style JSON
 */

import { layerManager } from '../layers/LayerManager.js';

// ---- FSL conversion ----

/**
 * Convert an internal layer style to a Felt Style Language (FSL) object.
 * Returns a plain JS object ready to JSON.stringify().
 */
export function toFSL(layer) {
  const s = layer.style || {};
  const gt = layer.geometryType;

  const base = {
    version: '2.0',
    opacity: s.pointOpacity ?? s.lineOpacity ?? s.fillOpacity ?? 1.0,
  };

  if (s.labelField) {
    base.label = {
      field: s.labelField,
      fontSize: s.labelSize || 12,
      color: s.labelColor || '#ffffff',
      haloColor: s.labelHaloColor || '#000000',
      haloWidth: s.labelHaloWidth || 1,
    };
  }

  if (gt === 'Point') {
    return {
      ...base,
      type: 'simple',
      symbol: s.pointSymbol || 'circle',
      color: s.pointColor || '#60a5fa',
      size: s.pointRadius || 6,
      strokeColor: s.strokeColor || '#ffffff',
      strokeWidth: s.strokeWidth || 1.5,
      ...classificationFSL(s),
    };
  }

  if (gt === 'LineString') {
    return {
      ...base,
      type: 'simple',
      color: s.lineColor || '#f97316',
      width: s.lineWidth || 2,
      dashArray: s.lineDashArray || null,
      ...classificationFSL(s),
    };
  }

  // Polygon
  return {
    ...base,
    type: 'simple',
    color: s.fillColor || '#a78bfa',
    fillOpacity: s.fillOpacity ?? 0.35,
    strokeColor: s.strokeColor || s.fillColor || '#a78bfa',
    strokeWidth: s.strokeWidth || 1.5,
    ...classificationFSL(s),
  };
}

/**
 * Convert a Felt FSL object back to an internal layer style.
 */
export function fromFSL(fsl, geometryType) {
  const style = {};

  if (geometryType === 'Point') {
    style.pointSymbol  = fsl.symbol || 'circle';
    style.pointColor   = fsl.color || '#60a5fa';
    style.pointRadius  = fsl.size || 6;
    style.strokeColor  = fsl.strokeColor || '#ffffff';
    style.strokeWidth  = fsl.strokeWidth || 1.5;
    style.pointOpacity = fsl.opacity ?? 0.85;
  } else if (geometryType === 'LineString') {
    style.lineColor    = fsl.color || '#f97316';
    style.lineWidth    = fsl.width || 2;
    style.lineDashArray = fsl.dashArray || null;
    style.lineOpacity  = fsl.opacity ?? 0.9;
  } else {
    style.fillColor    = fsl.color || '#a78bfa';
    style.fillOpacity  = fsl.fillOpacity ?? 0.35;
    style.strokeColor  = fsl.strokeColor || '#a78bfa';
    style.strokeWidth  = fsl.strokeWidth || 1.5;
  }

  if (fsl.label) {
    style.labelField     = fsl.label.field || null;
    style.labelSize      = fsl.label.fontSize || 12;
    style.labelColor     = fsl.label.color || '#ffffff';
    style.labelHaloColor = fsl.label.haloColor || '#000000';
    style.labelHaloWidth = fsl.label.haloWidth || 1;
  }

  if (fsl.type && fsl.type !== 'simple') {
    style.type = fsl.type;
    if (fsl.classificationField) style.classificationField = fsl.classificationField;
    if (fsl.classes) style.classes = fsl.classes;
  } else {
    style.type = 'single';
  }

  return style;
}

function classificationFSL(s) {
  if (s.type === 'graduated' || s.type === 'categorized') {
    return {
      type: s.type,
      classificationField: s.classificationField,
      classes: s.classes || [],
    };
  }
  return {};
}

// ---- Felt API upload ----

export class FeltManager {
  constructor() {
    this._baseUrl = 'https://felt.com/api/v2';
  }

  _apiKey() {
    return localStorage.getItem('felt_api_key') || '';
  }

  /**
   * Upload a layer to Felt.
   * @param {object} layer  - internal layer object
   * @param {string} mapId  - Felt map ID
   * @param {boolean} withStyle - whether to attach FSL styling
   * @returns {{ ok: boolean, error?: string, feltLayerId?: string }}
   */
  async uploadLayer(layer, mapId, withStyle = true) {
    const apiKey = this._apiKey();
    if (!apiKey) return { ok: false, error: 'No Felt API key configured (Settings → Felt Integration)' };
    if (!layer.data?.features?.length) return { ok: false, error: 'Layer has no features to upload' };

    try {
      // Step 1: Create upload slot
      const createRes = await fetch(`${this._baseUrl}/maps/${mapId}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: layer.name }),
      });

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        return { ok: false, error: err.message || `HTTP ${createRes.status}` };
      }

      const uploadInfo = await createRes.json();
      const { id: feltLayerId, presigned_attributes, url: uploadUrl } = uploadInfo.data || uploadInfo;

      if (!uploadUrl) return { ok: false, error: 'Felt API did not return an upload URL' };

      // Step 2: Upload GeoJSON to presigned S3 URL
      const geojsonStr = JSON.stringify(layer.data);
      const formData = new FormData();

      // Attach presigned S3 fields if provided
      if (presigned_attributes) {
        for (const [k, v] of Object.entries(presigned_attributes)) {
          formData.append(k, v);
        }
      }
      formData.append('file', new Blob([geojsonStr], { type: 'application/geo+json' }), `${layer.name}.geojson`);

      const uploadRes = await fetch(uploadUrl, { method: 'POST', body: formData });
      if (!uploadRes.ok && uploadRes.status !== 204) {
        return { ok: false, error: `S3 upload failed: HTTP ${uploadRes.status}` };
      }

      // Step 3: Finalize upload (some Felt API versions require this)
      const finalizeUrl = `${this._baseUrl}/maps/${mapId}/upload/${feltLayerId}/finish_upload`;
      const finalizeRes = await fetch(finalizeUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }).catch(() => null);
      // Non-fatal if finalize doesn't exist

      // Step 4: Apply FSL style if requested
      if (withStyle && feltLayerId) {
        const fsl = toFSL(layer);
        await this._applyStyle(mapId, feltLayerId, fsl, apiKey);
      }

      return { ok: true, feltLayerId };

    } catch (e) {
      console.error('Felt upload error:', e);
      return { ok: false, error: e.message || String(e) };
    }
  }

  async _applyStyle(mapId, layerId, fsl, apiKey) {
    try {
      await fetch(`${this._baseUrl}/maps/${mapId}/layers/${layerId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ style: fsl }),
      });
    } catch (e) {
      console.warn('Could not apply FSL style to Felt layer:', e);
    }
  }

  /**
   * Export layer FSL as a downloadable JSON file.
   */
  exportFSL(layer) {
    const fsl = toFSL(layer);
    const blob = new Blob([JSON.stringify(fsl, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${layer.name.replace(/\s+/g,'_')}_style.fsl.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const feltManager = new FeltManager();
