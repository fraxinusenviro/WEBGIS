/**
 * FeltManager — Felt API integration
 *
 * Handles:
 *  - API key storage (localStorage)
 *  - Felt Style Language (FSL) conversion from internal layer style
 *  - File upload to a Felt map via the Felt REST API v2
 *
 * Felt API reference: https://feltmaps.notion.site/Felt-Public-API
 *
 * Upload workflow:
 *   1. POST /api/v2/maps/{map_id}/upload  → { presigned_attributes, s3_url, upload_id }
 *   2. PUT  <s3_url>  (multipart form with presigned_attributes + file)
 *   3. PATCH /api/v2/maps/{map_id}/upload/{upload_id}  → triggers processing
 */

import { layerManager } from '../layers/LayerManager.js';
import { bus, EVENTS } from '../utils/EventBus.js';

const FELT_API = 'https://felt.com/api/v2';
const LS_API_KEY = 'felt_api_key';
const LS_MAP_ID  = 'felt_default_map_id';

export class FeltManager {
  constructor() {}

  // ── API Key & Map ID ─────────────────────────────────────────────────────

  getApiKey() {
    return localStorage.getItem(LS_API_KEY) || '';
  }

  setApiKey(key) {
    localStorage.setItem(LS_API_KEY, key.trim());
  }

  getMapId() {
    return localStorage.getItem(LS_MAP_ID) || '';
  }

  setMapId(id) {
    localStorage.setItem(LS_MAP_ID, id.trim());
  }

  hasCredentials() {
    return !!(this.getApiKey() && this.getMapId());
  }

  // ── Felt Style Language (FSL) Conversion ─────────────────────────────────

  /**
   * Convert an internal layer style object to a Felt Style Language (FSL) object.
   * FSL reference: https://developers.felt.com/felt-style-language
   *
   * @param {Object} layer - internal layer object
   * @returns {Object} FSL style definition
   */
  toFSL(layer) {
    const s = layer.style || {};
    const gt = layer.geometryType;

    // Common FSL root
    const fsl = {
      version: '2.1',
      style: [],
    };

    if (gt === 'Point') {
      const rule = {
        color: s.pointColor || '#60a5fa',
        size: (s.pointRadius || 6) * 2,
        opacity: s.pointOpacity ?? 0.85,
        strokeColor: s.strokeColor || '#ffffff',
        strokeWidth: s.strokeWidth || 1.5,
        symbol: this._shapToFeltSymbol(s.pointShape || 'circle'),
      };

      if (s.type === 'categorized' && s.classificationField && s.classes?.length) {
        fsl.style = s.classes.map(cls => ({
          ...rule,
          color: cls.color,
          filter: ['==', ['get', s.classificationField], cls.value],
          label: cls.label || String(cls.value),
        }));
      } else if (s.type === 'graduated' && s.classificationField && s.classes?.length) {
        fsl.style = s.classes.map(cls => ({
          ...rule,
          color: cls.color,
          filter: ['all',
            ['>=', ['get', s.classificationField], cls.min],
            ['<',  ['get', s.classificationField], cls.max],
          ],
          label: cls.label,
        }));
      } else {
        fsl.style = [rule];
      }

    } else if (gt === 'LineString') {
      const rule = {
        color: s.lineColor || '#f97316',
        width: s.lineWidth || 2,
        opacity: s.lineOpacity ?? 0.9,
        dashPattern: s.lineDashArray || null,
      };
      fsl.style = [rule];

    } else if (gt === 'Polygon') {
      const rule = {
        color: s.fillColor || '#a78bfa',
        fillOpacity: s.fillOpacity ?? 0.35,
        strokeColor: s.strokeColor || s.fillColor || '#a78bfa',
        strokeWidth: s.strokeWidth || 1.5,
        opacity: layer.opacity ?? 1,
      };

      if (s.type === 'categorized' && s.classificationField && s.classes?.length) {
        fsl.style = s.classes.map(cls => ({
          ...rule,
          color: cls.color,
          filter: ['==', ['get', s.classificationField], cls.value],
          label: cls.label || String(cls.value),
        }));
      } else if (s.type === 'graduated' && s.classificationField && s.classes?.length) {
        fsl.style = s.classes.map(cls => ({
          ...rule,
          color: cls.color,
          filter: ['all',
            ['>=', ['get', s.classificationField], cls.min],
            ['<',  ['get', s.classificationField], cls.max],
          ],
          label: cls.label,
        }));
      } else {
        fsl.style = [rule];
      }
    }

    // Label
    if (s.labelField) {
      fsl.label = {
        field: s.labelField,
        fontSize: s.labelSize || 12,
        color: s.labelColor || '#ffffff',
        haloColor: s.labelHaloColor || '#000000',
      };
    }

    return fsl;
  }

  /** Map internal shape name to Felt symbol name */
  _shapToFeltSymbol(shape) {
    const map = {
      circle:   'circle',
      square:   'square',
      triangle: 'triangle',
      diamond:  'diamond',
      cross:    'cross',
      x:        'cross-x',
      octagon:  'octagon',
      star:     'star',
      pentagon: 'pentagon',
    };
    return map[shape] || 'circle';
  }

  // ── Upload to Felt ────────────────────────────────────────────────────────

  /**
   * Upload a layer to Felt.
   * @param {string} layerId
   * @param {Object} [opts] - { mapId, apiKey }
   */
  async uploadLayer(layerId, opts = {}) {
    const apiKey = opts.apiKey || this.getApiKey();
    const mapId  = opts.mapId  || this.getMapId();

    if (!apiKey) throw new Error('Felt API key not set. Configure it in Settings.');
    if (!mapId)  throw new Error('Felt Map ID not set. Configure it in Settings.');

    const layer = layerManager.layers.find(l => l.id === layerId);
    if (!layer) throw new Error(`Layer not found: ${layerId}`);
    if (layer.type !== 'vector' && layer.type !== 'esri-feature') {
      throw new Error('Only vector layers can be uploaded to Felt.');
    }

    const geojson = layer.data;
    if (!geojson?.features?.length) {
      throw new Error('Layer has no features to upload.');
    }

    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: `Uploading "${layer.name}" to Felt…` });

    // Step 1: Create upload entry
    const createResp = await fetch(`${FELT_API}/maps/${mapId}/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: layer.name }),
    });

    if (!createResp.ok) {
      const err = await createResp.text();
      throw new Error(`Felt upload init failed (${createResp.status}): ${err}`);
    }

    const { presigned_attributes, s3_url, upload_id } = await createResp.json();

    // Step 2: Upload GeoJSON file to S3 presigned URL
    const blob = new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' });
    const formData = new FormData();

    // Add presigned attributes from S3 (policy, signature, etc.)
    if (presigned_attributes) {
      for (const [k, v] of Object.entries(presigned_attributes)) {
        formData.append(k, v);
      }
    }
    formData.append('file', blob, `${layer.name}.geojson`);

    const s3Resp = await fetch(s3_url, { method: 'POST', body: formData });
    if (!s3Resp.ok && s3Resp.status !== 204) {
      throw new Error(`S3 upload failed (${s3Resp.status})`);
    }

    // Step 3: Finalize upload (trigger Felt processing)
    const finalizeResp = await fetch(`${FELT_API}/maps/${mapId}/upload/${upload_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ done: true }),
    });

    if (!finalizeResp.ok) {
      const err = await finalizeResp.text();
      throw new Error(`Felt finalize failed (${finalizeResp.status}): ${err}`);
    }

    const result = await finalizeResp.json();
    const feltLayerId = result?.layer_id || result?.id;

    // Step 4: Apply FSL style if we have a layer ID
    if (feltLayerId) {
      await this._applyFSLToLayer(mapId, feltLayerId, layer, apiKey);
    }

    bus.emit(EVENTS.SHOW_TOAST, {
      type: 'success',
      message: `"${layer.name}" uploaded to Felt successfully!`,
    });

    return result;
  }

  /** Apply FSL styling to a Felt layer after upload */
  async _applyFSLToLayer(mapId, feltLayerId, layer, apiKey) {
    const fsl = this.toFSL(layer);
    try {
      const resp = await fetch(`${FELT_API}/maps/${mapId}/layers/${feltLayerId}/style`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ style: fsl }),
      });
      if (!resp.ok) {
        console.warn('FSL style apply failed:', resp.status);
      }
    } catch (e) {
      console.warn('FSL style apply error:', e);
    }
  }

  /**
   * Open a Felt map by ID in a new tab.
   * @param {string} [mapId]
   */
  openMap(mapId) {
    const id = mapId || this.getMapId();
    if (!id) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'No Felt Map ID configured' });
      return;
    }
    window.open(`https://felt.com/map/${id}`, '_blank');
  }
}

export const feltManager = new FeltManager();
