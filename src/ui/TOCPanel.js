import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { exportManager } from '../io/ExportManager.js';
import { editingManager } from '../editing/EditingManager.js';
import { basemapLayerManager, BM_EVENTS } from '../map/BasemapLayerManager.js';
import { BASEMAPS } from '../map/BasemapManager.js';
import { openModal, closeModal } from './Modal.js';
import { feltManager } from '../io/FeltManager.js';

/**
 * TOCPanel — Table of Contents (layer list)
 */
export class TOCPanel {
  constructor() {
    this._container = document.getElementById('layer-list');
    this._bmContainer = document.getElementById('basemap-list');
    this._selectedLayerId = null;
    this._editingLayerId = null;

    bus.on(EVENTS.LAYER_ADDED, () => this.render());
    bus.on(EVENTS.LAYER_REMOVED, () => this.render());
    bus.on(EVENTS.LAYER_UPDATED, () => this.render());
    bus.on(EVENTS.LAYER_VISIBILITY, () => this.render());
    bus.on(EVENTS.LAYER_ORDER, () => this.render());
    bus.on(EVENTS.LAYER_STYLE_CHANGE, () => this.render());
    bus.on(EVENTS.PROJECT_LOADED, () => { this.render(); this.renderBasemaps(); });
    bus.on(EVENTS.PROJECT_NEW, () => { this.render(); this.renderBasemaps(); });

    bus.on(BM_EVENTS.ADDED, () => this.renderBasemaps());
    bus.on(BM_EVENTS.REMOVED, () => this.renderBasemaps());
    bus.on(BM_EVENTS.UPDATED, () => this.renderBasemaps());
    bus.on(BM_EVENTS.ORDER, () => this.renderBasemaps());
  }

  render() {
    const layers = layerManager.layers;
    if (!layers.length) {
      this._container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24"><path d="M3 6l9-3 9 3-9 3z"/><path d="M3 12l9-3 9 3-9 3z"/><path d="M3 18l9-3 9 3-9 3z"/></svg>
          <p>No layers yet.<br>Add a file or service to begin.</p>
        </div>`;
      return;
    }

    this._container.innerHTML = '';
    // Render in reverse order (top of stack = first in TOC)
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const item = this._buildItem(layer);
      this._container.appendChild(item);
    }
  }

  _buildItem(layer) {
    const isEditing = this._editingLayerId === layer.id;
    const isVector = layer.type === 'vector' || layer.type === 'esri-feature';

    const item = document.createElement('div');
    item.className = `layer-item${layer.visible ? '' : ' hidden-layer'}${this._selectedLayerId === layer.id ? ' selected' : ''}${isEditing ? ' editing' : ''}`;
    item.dataset.layerId = layer.id;

    item.innerHTML = `
      <!-- Row 1: type-icon + name + order buttons -->
      <div class="layer-row-name">
        <div class="layer-type-icon ${typeIconClass(layer)}" title="${layer.type}">${typeIconSVG(layer)}</div>
        <span class="layer-name" title="${layer.name}">${layer.name}</span>
        <div class="layer-order-btns" style="margin-left:auto">
          <button class="layer-order-btn btn-move-up" title="Move up">▲</button>
          <button class="layer-order-btn btn-move-down" title="Move down">▼</button>
        </div>
      </div>
      <!-- Row 2: action buttons -->
      <div class="layer-row-actions">
        <button class="layer-visibility${layer.visible ? '' : ' hidden-layer'}" title="${layer.visible ? 'Hide layer' : 'Show layer'}">
          ${layer.visible ? eyeIcon() : eyeOffIcon()}
        </button>
        ${isVector ? `<button class="layer-action-btn btn-edit-toggle${isEditing ? ' active' : ''}" title="${isEditing ? 'Stop Editing' : 'Edit Layer'}">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>` : ''}
        <button class="layer-action-btn btn-style" title="Symbology">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/></svg>
        </button>
        <button class="layer-action-btn btn-zoom" title="Zoom to layer">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button class="layer-action-btn btn-table" title="Attribute table" ${!isVector ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
        <button class="layer-action-btn btn-more" title="More options">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
        <button class="layer-action-btn danger btn-remove" title="Remove layer">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/></svg>
        </button>
      </div>
      <!-- Row 3: collapsible legend -->
      <div class="layer-legend-wrap">
        <div class="layer-legend-header">
          <span class="layer-legend-chevron open">▸</span>
          <span>Legend</span>
        </div>
        <div class="layer-legend-content">
          ${this._buildLegend(layer)}
        </div>
      </div>
    `;

    // Row 1: select layer on click (not on buttons)
    const nameRow = item.querySelector('.layer-row-name');
    nameRow.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.layer-order-btns')) return;
      this._selectedLayerId = layer.id;
      this.render();
      bus.emit(EVENTS.LAYER_SELECTED, layer);
      window._rightPanel?.showSymbology(layer);
    });

    // Visibility toggle
    item.querySelector('.layer-visibility').addEventListener('click', (e) => {
      e.stopPropagation();
      layerManager.toggleVisibility(layer.id);
    });

    // Move up
    item.querySelector('.btn-move-up').addEventListener('click', (e) => {
      e.stopPropagation();
      this._moveLayerUp(layer.id);
    });

    // Move down
    item.querySelector('.btn-move-down').addEventListener('click', (e) => {
      e.stopPropagation();
      this._moveLayerDown(layer.id);
    });

    // Edit toggle (vector layers only)
    const editToggleBtn = item.querySelector('.btn-edit-toggle');
    if (editToggleBtn) {
      editToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleEditing(layer);
      });
    }

    // Zoom to
    item.querySelector('.btn-zoom').addEventListener('click', (e) => {
      e.stopPropagation();
      layerManager.zoomToLayer(layer.id);
    });

    // Style button — open right panel symbology tab
    item.querySelector('.btn-style').addEventListener('click', (e) => {
      e.stopPropagation();
      bus.emit(EVENTS.SHOW_SYMBOLOGY, layer);
    });

    // Attribute table
    const tableBtn = item.querySelector('.btn-table');
    if (tableBtn && !tableBtn.disabled) {
      tableBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bus.emit(EVENTS.SHOW_ATTR_TABLE, layer);
      });
    }

    // More options (context menu)
    item.querySelector('.btn-more').addEventListener('click', (e) => {
      e.stopPropagation();
      this._showContextMenu(layer, e);
    });

    // Remove
    item.querySelector('.btn-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Remove layer "${layer.name}"?`)) {
        layerManager.removeLayer(layer.id);
      }
    });

    // Legend toggle
    const legendHeader = item.querySelector('.layer-legend-header');
    const legendContent = item.querySelector('.layer-legend-content');
    const legendChevron = item.querySelector('.layer-legend-chevron');
    legendHeader.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = legendContent.style.display !== 'none';
      legendContent.style.display = isOpen ? 'none' : 'block';
      legendChevron.classList.toggle('open', !isOpen);
    });

    return item;
  }

  _buildLegend(layer) {
    const s = layer.style || {};
    const isVector = layer.type === 'vector' || layer.type === 'esri-feature';
    const gt = layer.geometryType;

    if (!isVector) {
      return `<div class="legend-row"><span class="legend-swatch" style="background:linear-gradient(135deg,#666,#999)"></span><span class="legend-label">Raster</span></div>`;
    }

    if ((s.type === 'graduated' || s.type === 'categorized') && s.classes?.length) {
      return s.classes.map(cls => {
        let swatch = '';
        if (gt === 'Point') {
          swatch = `<span class="legend-point" style="background:${cls.color}"></span>`;
        } else if (gt === 'LineString') {
          swatch = `<span class="legend-line" style="background:${cls.color}"></span>`;
        } else {
          swatch = `<span class="legend-swatch" style="background:${cls.color}"></span>`;
        }
        return `<div class="legend-row">${swatch}<span class="legend-label">${cls.label || cls.value || ''}</span></div>`;
      }).join('');
    }

    // Single symbol
    const color = s.fillColor || s.lineColor || s.pointColor || '#888';
    if (gt === 'Point') {
      return `<div class="legend-row"><span class="legend-point" style="background:${color};border-color:${s.strokeColor||'rgba(255,255,255,0.3)'}"></span><span class="legend-label">${layer.name}</span></div>`;
    }
    if (gt === 'LineString') {
      return `<div class="legend-row"><span class="legend-line" style="background:${color}"></span><span class="legend-label">${layer.name}</span></div>`;
    }
    if (gt === 'Polygon') {
      return `<div class="legend-row"><span class="legend-swatch" style="background:${color}"></span><span class="legend-label">${layer.name}</span></div>`;
    }
    return `<div class="legend-row"><span class="legend-swatch" style="background:#888"></span><span class="legend-label">${layer.name}</span></div>`;
  }

  _toggleEditing(layer) {
    if (this._editingLayerId === layer.id) {
      editingManager.clearEditLayer();
      this._editingLayerId = null;
      bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: `Stopped editing: ${layer.name}` });
    } else {
      if (this._editingLayerId) {
        editingManager.clearEditLayer();
      }
      this._editingLayerId = layer.id;
      editingManager.setEditLayer(layer.id, false);
      bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: `Editing: ${layer.name}. Use draw tools to add features.` });
    }
    this.render();
  }

  _moveLayerUp(layerId) {
    const layers = layerManager.layers;
    const tocOrder = [...layers].reverse().map(l => l.id); // TOC display order (top first)
    const idx = tocOrder.indexOf(layerId);
    if (idx <= 0) return;
    [tocOrder[idx - 1], tocOrder[idx]] = [tocOrder[idx], tocOrder[idx - 1]];
    layerManager.reorderLayers([...tocOrder].reverse());
  }

  _moveLayerDown(layerId) {
    const layers = layerManager.layers;
    const tocOrder = [...layers].reverse().map(l => l.id);
    const idx = tocOrder.indexOf(layerId);
    if (idx < 0 || idx >= tocOrder.length - 1) return;
    [tocOrder[idx], tocOrder[idx + 1]] = [tocOrder[idx + 1], tocOrder[idx]];
    layerManager.reorderLayers([...tocOrder].reverse());
  }

  renderBasemaps() {
    if (!this._bmContainer) return;
    const stack = basemapLayerManager.stack;
    if (!stack.length) {
      this._bmContainer.innerHTML = '<div class="bm-empty">No basemaps. Click + to add one.</div>';
      return;
    }
    this._bmContainer.innerHTML = '';
    // Render in reverse order (top rendered = first shown in TOC)
    const reversed = [...stack].reverse();
    for (const entry of reversed) {
      this._bmContainer.appendChild(this._buildBasemapItem(entry));
    }
  }

  _buildBasemapItem(entry) {
    const div = document.createElement('div');
    div.className = `basemap-item${entry.visible ? '' : ' bm-hidden'}`;
    div.dataset.bmUid = entry.uid;

    const satDisplay = entry.saturation >= 0 ? `+${(entry.saturation * 100).toFixed(0)}%` : `${(entry.saturation * 100).toFixed(0)}%`;

    div.innerHTML = `
      <div class="bm-header">
        <button class="bm-vis-btn${entry.visible ? '' : ' bm-off'}" title="${entry.visible ? 'Hide basemap' : 'Show basemap'}">
          ${entry.visible ? eyeIcon() : eyeOffIcon()}
        </button>
        <span class="bm-name">${entry.name}</span>
        <div class="bm-order-btns">
          <button class="bm-order-btn bm-up" title="Move up">▲</button>
          <button class="bm-order-btn bm-down" title="Move down">▼</button>
        </div>
        <button class="bm-remove-btn" title="Remove basemap">
          <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="bm-controls">
        <label>Opacity</label>
        <div class="bm-slider-row">
          <input type="range" class="bm-opacity-slider" min="0" max="1" step="0.05" value="${entry.opacity}">
          <span class="bm-op-val">${Math.round(entry.opacity * 100)}%</span>
        </div>
        <label>Saturation</label>
        <div class="bm-slider-row">
          <input type="range" class="bm-sat-slider" min="-1" max="1" step="0.05" value="${entry.saturation}">
          <span class="bm-sat-val">${satDisplay}</span>
        </div>
      </div>
    `;

    // Visibility toggle
    div.querySelector('.bm-vis-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      basemapLayerManager.toggleVisible(entry.uid);
    });

    // Move up (in TOC = higher in stack)
    div.querySelector('.bm-up').addEventListener('click', (e) => {
      e.stopPropagation();
      basemapLayerManager.moveUp(entry.uid);
    });

    // Move down
    div.querySelector('.bm-down').addEventListener('click', (e) => {
      e.stopPropagation();
      basemapLayerManager.moveDown(entry.uid);
    });

    // Remove
    div.querySelector('.bm-remove-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      basemapLayerManager.removeBasemap(entry.uid);
    });

    // Opacity slider
    const opSlider = div.querySelector('.bm-opacity-slider');
    const opVal = div.querySelector('.bm-op-val');
    opSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      opVal.textContent = `${Math.round(val * 100)}%`;
      basemapLayerManager.setOpacity(entry.uid, val);
    });

    // Saturation slider
    const satSlider = div.querySelector('.bm-sat-slider');
    const satVal = div.querySelector('.bm-sat-val');
    satSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      satVal.textContent = val >= 0 ? `+${(val * 100).toFixed(0)}%` : `${(val * 100).toFixed(0)}%`;
      basemapLayerManager.setSaturation(entry.uid, val);
    });

    return div;
  }

  showBasemapPicker() {
    const content = document.createElement('div');
    content.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
    const presets = Object.entries(BASEMAPS).filter(([id]) => id !== 'none');
    for (const [id, bm] of presets) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-secondary';
      btn.style.cssText = 'justify-content:flex-start;font-size:12px;padding:8px 10px;';
      btn.textContent = bm.name;
      btn.addEventListener('click', () => {
        basemapLayerManager.addBasemap(id);
        closeModal();
      });
      content.appendChild(btn);
    }
    openModal({ title: 'Add Basemap', content, width: 380 });
  }

  _showContextMenu(layer, e) {
    const menu = document.getElementById('context-menu');
    menu.innerHTML = `
      <div class="ctx-item" data-action="rename">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        Rename
      </div>
      ${(layer.type === 'vector' || layer.type === 'esri-feature') ? `
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-action="export-geojson">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export as GeoJSON
      </div>
      <div class="ctx-item" data-action="export-shp">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export as Shapefile
      </div>
      <div class="ctx-item" data-action="export-csv">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export as CSV
      </div>
      <div class="ctx-item" data-action="export-kml">
        <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export as KML
      </div>
      <div class="ctx-item" data-action="export-fsl">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/></svg>
        Export FSL Style (Felt)
      </div>
      ` : ''}
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-action="zoom">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Zoom to Layer
      </div>
      <div class="ctx-item danger" data-action="remove">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        Remove Layer
      </div>
    `;

    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 200)}px`;
    menu.classList.remove('hidden');

    const close = () => {
      menu.classList.add('hidden');
      document.removeEventListener('click', close, true);
    };

    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        close();
        this._handleContextAction(action, layer);
      });
    });

    setTimeout(() => document.addEventListener('click', close, true), 0);
  }

  _handleContextAction(action, layer) {
    switch(action) {
      case 'rename':
        const name = prompt('New layer name:', layer.name);
        if (name?.trim()) layerManager.updateLayer(layer.id, { name: name.trim() });
        break;
      case 'export-geojson': exportManager.exportGeoJSON(layer.id); break;
      case 'export-shp': exportManager.exportShapefile(layer.id); break;
      case 'export-csv': exportManager.exportCSV(layer.id); break;
      case 'export-kml': exportManager.exportKML(layer.id); break;
      case 'export-fsl': feltManager.exportFSL(layer); break;
      case 'zoom': layerManager.zoomToLayer(layer.id); break;
      case 'remove':
        if (confirm(`Remove "${layer.name}"?`)) layerManager.removeLayer(layer.id);
        break;
    }
  }

  _getLayerColor(layer) {
    const s = layer.style;
    if (!s) return '#888';
    return s.fillColor || s.lineColor || s.pointColor || '#888';
  }
}

// ---- Icon helpers ----
function eyeIcon() {
  return `<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}
function eyeOffIcon() {
  return `<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
}

function typeIconClass(layer) {
  if (layer.type === 'vector' || layer.type === 'esri-feature') {
    return `type-vector-${layer.geometryType?.toLowerCase() || 'point'}`;
  }
  if (layer.type === 'wms' || layer.type === 'wmts') return 'type-wms';
  if (layer.type === 'cog' || layer.type === 'image') return 'type-raster';
  return 'type-tile';
}

function typeIconSVG(layer) {
  if (layer.type === 'vector' || layer.type === 'esri-feature') {
    if (layer.geometryType === 'Polygon') {
      return `<svg viewBox="0 0 24 24"><polygon points="12,3 20,9 17,19 7,19 4,9"/></svg>`;
    }
    if (layer.geometryType === 'LineString') {
      return `<svg viewBox="0 0 24 24"><polyline points="3,17 7,7 13,13 17,5 21,9"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>`;
  }
  if (layer.type === 'cog' || layer.type === 'image' || layer.sourceFormat === 'geotiff') {
    return `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10z"/></svg>`;
}
