import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { gpTools } from '../geoprocessing/GeoprocessingTools.js';
import { openModal, closeModal } from './Modal.js';

const TOOLS = [
  { id: 'buffer',       label: 'Buffer',        icon: buffer_icon(),      desc: 'Create buffer zones around features' },
  { id: 'dissolve',     label: 'Dissolve',       icon: dissolve_icon(),    desc: 'Merge features by attribute or all into one' },
  { id: 'clip',         label: 'Clip',           icon: clip_icon(),        desc: 'Clip layer A by the extent of layer B' },
  { id: 'intersect',    label: 'Intersect',      icon: intersect_icon(),   desc: 'Find overlapping features' },
  { id: 'union',        label: 'Union',          icon: union_icon(),       desc: 'Merge two polygon layers' },
  { id: 'difference',   label: 'Difference',     icon: diff_icon(),        desc: 'Features in A not overlapping B' },
  { id: 'convex-hull',  label: 'Convex Hull',    icon: hull_icon(),        desc: 'Minimum convex polygon enclosing all features' },
  { id: 'centroid',     label: 'Centroid',       icon: centroid_icon(),    desc: 'Calculate centroids of features' },
  { id: 'simplify',     label: 'Simplify',       icon: simplify_icon(),    desc: 'Reduce vertex count (Douglas-Peucker)' },
  { id: 'bbox',         label: 'Bounding Box',   icon: bbox_icon(),        desc: 'Create bounding rectangle' },
  { id: 'voronoi',      label: 'Voronoi',        icon: voronoi_icon(),     desc: 'Voronoi diagram from point layer' },
  { id: 'spatial-join', label: 'Spatial Join',   icon: join_icon(),        desc: 'Join attributes from polygons to points' },
  { id: 'spatial-filter',label:'Spatial Filter', icon: filter_icon(),      desc: 'Keep features within polygon boundary' },
  { id: 'calc-area',    label: 'Calculate Area', icon: area_icon(),        desc: 'Add area field to polygon layer' },
  { id: 'calc-length',  label: 'Calc. Length',   icon: length_icon(),      desc: 'Add length field to line layer' },
  { id: 'merge',        label: 'Merge Layers',   icon: merge_icon(),       desc: 'Combine multiple layers into one' },
  { id: 'line-to-poly', label: 'Line → Polygon', icon: l2p_icon(),         desc: 'Convert closed lines to polygons' },
];

export class GeoprocessingPanel {
  constructor() {
    bus.on(EVENTS.SHOW_GP_PANEL, () => this.open());
  }

  open() {
    const content = document.createElement('div');
    content.innerHTML = `
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
        Select a tool to run. Results are added as new layers.
      </p>
      <div class="gp-tool-grid">
        ${TOOLS.map(t => `
          <button class="gp-tool-btn" data-tool="${t.id}" title="${t.desc}">
            ${t.icon}
            <span>${t.label}</span>
          </button>
        `).join('')}
      </div>
    `;

    openModal({ title: 'Geoprocessing Tools', content, width: 520 });

    content.querySelectorAll('.gp-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal();
        setTimeout(() => this._runTool(btn.dataset.tool), 150);
      });
    });
  }

  _runTool(toolId) {
    const vectorLayers = layerManager.layers.filter(l => l.type === 'vector' || l.type === 'esri-feature');
    if (!vectorLayers.length) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'No vector layers available' });
      return;
    }

    const layerOptions = vectorLayers.map(l => `<option value="${l.id}">${l.name}</option>`).join('');

    switch(toolId) {
      case 'buffer': this._showBufferDialog(layerOptions); break;
      case 'dissolve': this._showDissolveDialog(layerOptions); break;
      case 'clip': case 'intersect': case 'union': case 'difference': case 'spatial-join': case 'spatial-filter':
        this._showTwoLayerDialog(toolId, layerOptions);
        break;
      case 'convex-hull': this._showSingleLayerDialog(toolId, 'Convex Hull', layerOptions); break;
      case 'centroid':    this._showSingleLayerDialog(toolId, 'Centroid', layerOptions); break;
      case 'bbox':        this._showSingleLayerDialog(toolId, 'Bounding Box', layerOptions); break;
      case 'voronoi':     this._showSingleLayerDialog(toolId, 'Voronoi', layerOptions); break;
      case 'line-to-poly':this._showSingleLayerDialog(toolId, 'Line → Polygon', layerOptions); break;
      case 'simplify':    this._showSimplifyDialog(layerOptions); break;
      case 'calc-area':   this._showCalcDialog(toolId, 'Calculate Area', layerOptions); break;
      case 'calc-length': this._showCalcDialog(toolId, 'Calculate Length', layerOptions); break;
      case 'merge':       this._showMergeDialog(layerOptions); break;
    }
  }

  _showBufferDialog(layerOptions) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Input Layer</label>
        <select class="form-select" id="gp-layer-a">${layerOptions}</select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Buffer Distance</label>
          <input type="number" class="form-input" id="gp-buf-dist" value="1" min="0" step="0.1">
        </div>
        <div class="form-group">
          <label class="form-label">Units</label>
          <select class="form-select" id="gp-buf-units">
            <option value="kilometers">Kilometers</option>
            <option value="meters">Meters</option>
            <option value="miles">Miles</option>
            <option value="feet">Feet</option>
          </select>
        </div>
      </div>
    `;
    openModal({
      title: 'Buffer',
      content,
      footer: footerHtml(),
      width: 380,
    });
    document.querySelector('#gp-run').addEventListener('click', async () => {
      closeModal();
      await this._run(() => gpTools.buffer(
        document.querySelector('#gp-layer-a')?.value,
        parseFloat(document.querySelector('#gp-buf-dist')?.value || 1),
        document.querySelector('#gp-buf-units')?.value || 'kilometers',
      ));
    });
    document.querySelector('#gp-cancel').addEventListener('click', closeModal);
  }

  _showDissolveDialog(layerOptions) {
    const content = document.createElement('div');
    const firstId = layerManager.layers.find(l => l.type === 'vector')?.id || '';
    const fields = firstId ? layerManager.getFields(firstId) : [];
    const fieldOpts = fields.map(f => `<option value="${f}">${f}</option>`).join('');

    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Input Layer</label>
        <select class="form-select" id="gp-layer-a">${layerOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Dissolve Field (optional)</label>
        <select class="form-select" id="gp-dissolve-field">
          <option value="">— All Features —</option>
          ${fieldOpts}
        </select>
      </div>
    `;
    openModal({ title: 'Dissolve', content, footer: footerHtml(), width: 380 });

    document.querySelector('#gp-layer-a').addEventListener('change', (e) => {
      const fields = layerManager.getFields(e.target.value);
      document.querySelector('#gp-dissolve-field').innerHTML =
        `<option value="">— All Features —</option>` +
        fields.map(f => `<option value="${f}">${f}</option>`).join('');
    });

    document.querySelector('#gp-run').addEventListener('click', async () => {
      closeModal();
      const field = document.querySelector('#gp-dissolve-field')?.value || null;
      await this._run(() => gpTools.dissolve(document.querySelector('#gp-layer-a')?.value, field || null));
    });
    document.querySelector('#gp-cancel').addEventListener('click', closeModal);
  }

  _showTwoLayerDialog(toolId, layerOptions) {
    const titles = {
      clip: 'Clip', intersect: 'Intersect', union: 'Union', difference: 'Difference',
      'spatial-join': 'Spatial Join', 'spatial-filter': 'Spatial Filter',
    };
    const bLabels = {
      clip: 'Clip Boundary (Layer B)', intersect: 'Layer B', union: 'Layer B',
      difference: 'Layer B (subtract)', 'spatial-join': 'Polygon Layer', 'spatial-filter': 'Boundary Layer',
    };
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Layer A (input)</label>
        <select class="form-select" id="gp-layer-a">${layerOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">${bLabels[toolId] || 'Layer B'}</label>
        <select class="form-select" id="gp-layer-b">${layerOptions}</select>
      </div>
    `;
    openModal({ title: titles[toolId] || toolId, content, footer: footerHtml(), width: 380 });

    document.querySelector('#gp-run').addEventListener('click', async () => {
      closeModal();
      const a = document.querySelector('#gp-layer-a')?.value;
      const b = document.querySelector('#gp-layer-b')?.value;
      const fns = {
        clip: () => gpTools.clip(a, b),
        intersect: () => gpTools.intersect(a, b),
        union: () => gpTools.union(a, b),
        difference: () => gpTools.difference(a, b),
        'spatial-join': () => gpTools.spatialJoin(a, b),
        'spatial-filter': () => gpTools.spatialFilter(a, b),
      };
      await this._run(fns[toolId]);
    });
    document.querySelector('#gp-cancel').addEventListener('click', closeModal);
  }

  _showSingleLayerDialog(toolId, title, layerOptions) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Input Layer</label>
        <select class="form-select" id="gp-layer-a">${layerOptions}</select>
      </div>
    `;
    openModal({ title, content, footer: footerHtml(), width: 340 });

    document.querySelector('#gp-run').addEventListener('click', async () => {
      closeModal();
      const a = document.querySelector('#gp-layer-a')?.value;
      const fns = {
        'convex-hull': () => gpTools.convexHull(a),
        centroid: () => gpTools.centroid(a),
        bbox: () => gpTools.bboxPolygon(a),
        voronoi: () => gpTools.voronoi(a),
        'line-to-poly': () => gpTools.lineToPolygon(a),
      };
      await this._run(fns[toolId]);
    });
    document.querySelector('#gp-cancel').addEventListener('click', closeModal);
  }

  _showSimplifyDialog(layerOptions) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Input Layer</label>
        <select class="form-select" id="gp-layer-a">${layerOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Tolerance (degrees)</label>
        <input type="number" class="form-input" id="gp-simplify-tol" value="0.001" min="0.0001" step="0.0001">
        <p class="form-hint">Higher = more simplification. Try 0.001 for moderate, 0.01 for aggressive.</p>
      </div>
    `;
    openModal({ title: 'Simplify', content, footer: footerHtml(), width: 380 });

    document.querySelector('#gp-run').addEventListener('click', async () => {
      closeModal();
      await this._run(() => gpTools.simplify(
        document.querySelector('#gp-layer-a')?.value,
        parseFloat(document.querySelector('#gp-simplify-tol')?.value || 0.001),
      ));
    });
    document.querySelector('#gp-cancel').addEventListener('click', closeModal);
  }

  _showCalcDialog(toolId, title, layerOptions) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Layer</label>
        <select class="form-select" id="gp-layer-a">${layerOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">Units</label>
        <select class="form-select" id="gp-calc-units">
          <option value="kilometers">Kilometers</option>
          <option value="meters">Meters</option>
          <option value="hectares">Hectares (area only)</option>
          <option value="miles">Miles</option>
        </select>
      </div>
    `;
    openModal({ title, content, footer: footerHtml(), width: 360 });

    document.querySelector('#gp-run').addEventListener('click', async () => {
      closeModal();
      const a = document.querySelector('#gp-layer-a')?.value;
      const units = document.querySelector('#gp-calc-units')?.value;
      await this._run(() => toolId === 'calc-area' ? gpTools.calculateArea(a, units) : gpTools.calculateLength(a, units));
    });
    document.querySelector('#gp-cancel').addEventListener('click', closeModal);
  }

  _showMergeDialog(layerOptions) {
    const layers = layerManager.layers.filter(l => l.type === 'vector' || l.type === 'esri-feature');
    const content = document.createElement('div');
    content.innerHTML = `
      <p class="form-hint" style="margin-bottom:12px">Select layers to merge into one:</p>
      ${layers.map(l => `
        <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">
          <input type="checkbox" class="merge-chk" value="${l.id}" checked>
          <span style="font-size:12px">${l.name}</span>
        </label>
      `).join('')}
    `;
    openModal({ title: 'Merge Layers', content, footer: footerHtml(), width: 360 });

    document.querySelector('#gp-run').addEventListener('click', async () => {
      closeModal();
      const ids = Array.from(document.querySelectorAll('.merge-chk:checked')).map(c => c.value);
      if (ids.length < 2) { bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'Select at least 2 layers to merge' }); return; }
      await this._run(() => gpTools.mergeLayers(ids));
    });
    document.querySelector('#gp-cancel').addEventListener('click', closeModal);
  }

  async _run(fn) {
    try {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Running geoprocessing…' });
      await fn();
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Geoprocessing error: ${e.message}` });
      console.error(e);
    }
  }
}

function footerHtml() {
  return `<button class="btn btn-ghost" id="gp-cancel">Cancel</button><button class="btn btn-primary" id="gp-run">Run</button>`;
}

// Icon SVGs
function buffer_icon() { return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8" stroke-dasharray="4 2"/></svg>`; }
function dissolve_icon() { return `<svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/></svg>`; }
function clip_icon() { return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="12"/><rect x="9" y="9" width="12" height="12"/></svg>`; }
function intersect_icon() { return `<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>`; }
function union_icon() { return `<svg viewBox="0 0 24 24"><path d="M6 12a6 6 0 1 0 12 0 6 6 0 1 0-12 0"/></svg>`; }
function diff_icon() { return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="12" height="12"/><rect x="9" y="9" width="12" height="12" fill="none"/></svg>`; }
function hull_icon() { return `<svg viewBox="0 0 24 24"><polygon points="12,3 21,9 18,20 6,20 3,9"/></svg>`; }
function centroid_icon() { return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" fill="currentColor"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/></svg>`; }
function simplify_icon() { return `<svg viewBox="0 0 24 24"><polyline points="3,12 7,8 11,14 15,6 21,12"/></svg>`; }
function bbox_icon() { return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" stroke-dasharray="4 2"/></svg>`; }
function voronoi_icon() { return `<svg viewBox="0 0 24 24"><path d="M12 3L3 12l9 9 9-9z"/></svg>`; }
function join_icon() { return `<svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="4"/><rect x="12" y="8" width="9" height="8"/><line x1="12" y1="12" x2="12" y2="12"/></svg>`; }
function filter_icon() { return `<svg viewBox="0 0 24 24"><polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/></svg>`; }
function area_icon() { return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/><text x="12" y="15" text-anchor="middle" font-size="8" fill="currentColor">m²</text></svg>`; }
function length_icon() { return `<svg viewBox="0 0 24 24"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="9" x2="3" y2="15"/><line x1="21" y1="9" x2="21" y2="15"/></svg>`; }
function merge_icon() { return `<svg viewBox="0 0 24 24"><line x1="6" y1="3" x2="6" y2="15"/><path d="M18 21a3 3 0 0 1-3-3V6a3 3 0 0 0-3-3H6"/><circle cx="18" cy="21" r="3"/><circle cx="6" cy="3" r="3"/></svg>`; }
function l2p_icon() { return `<svg viewBox="0 0 24 24"><polyline points="3,17 7,7 13,13 17,5 21,9"/><polygon points="7,7 13,13 17,5 21,9 21,20 3,20" opacity="0.4"/></svg>`; }
