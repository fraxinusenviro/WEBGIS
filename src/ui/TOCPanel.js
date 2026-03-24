import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { exportManager } from '../io/ExportManager.js';

/**
 * TOCPanel — Table of Contents (layer list)
 */
export class TOCPanel {
  constructor() {
    this._container = document.getElementById('layer-list');
    this._selectedLayerId = null;
    this._dragSrc = null;

    bus.on(EVENTS.LAYER_ADDED, () => this.render());
    bus.on(EVENTS.LAYER_REMOVED, () => this.render());
    bus.on(EVENTS.LAYER_UPDATED, () => this.render());
    bus.on(EVENTS.LAYER_VISIBILITY, () => this.render());
    bus.on(EVENTS.LAYER_ORDER, () => this.render());
    bus.on(EVENTS.LAYER_STYLE_CHANGE, () => this.render());
    bus.on(EVENTS.PROJECT_LOADED, () => this.render());
    bus.on(EVENTS.PROJECT_NEW, () => this.render());
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
    const item = document.createElement('div');
    item.className = `layer-item${layer.visible ? '' : ' hidden-layer'}${this._selectedLayerId === layer.id ? ' selected' : ''}`;
    item.dataset.layerId = layer.id;
    item.draggable = true;

    const styleColor = this._getLayerColor(layer);

    item.innerHTML = `
      <div class="layer-header">
        <span class="layer-drag-handle" title="Drag to reorder">⠿</span>
        <button class="layer-visibility${layer.visible ? '' : ' hidden-layer'}" title="${layer.visible ? 'Hide layer' : 'Show layer'}">
          ${layer.visible ? eyeIcon() : eyeOffIcon()}
        </button>
        <div class="layer-type-icon ${typeIconClass(layer)}" title="${layer.type}">${typeIconSVG(layer)}</div>
        <span class="layer-name" title="${layer.name}">${layer.name}</span>
        <div class="layer-actions">
          <button class="layer-action-btn btn-style" title="Symbology">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/></svg>
          </button>
          <button class="layer-action-btn btn-zoom" title="Zoom to layer">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </button>
          <button class="layer-action-btn btn-table" title="Attribute table" ${layer.type !== 'vector' && layer.type !== 'esri-feature' ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>
          <button class="layer-action-btn btn-more" title="More options">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
          <button class="layer-action-btn danger btn-remove" title="Remove layer">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/></svg>
          </button>
        </div>
      </div>
      <div class="layer-expand" id="expand-${layer.id}">
        <div class="layer-expand-row">
          <span class="layer-expand-label">Opacity</span>
          <input type="range" class="opacity-slider" min="0" max="1" step="0.05" value="${layer.opacity}" style="flex:1" />
          <span class="opacity-val" style="min-width:32px;text-align:right;font-size:11px;color:var(--text-secondary)">${Math.round(layer.opacity * 100)}%</span>
        </div>
        <div class="layer-expand-row">
          <span class="layer-expand-label">Color</span>
          <div class="layer-swatch" style="background:${styleColor}" title="Click to edit symbology"></div>
          <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${layer.geometryType || layer.type}</span>
        </div>
      </div>
    `;

    // Events
    const header = item.querySelector('.layer-header');
    const expandPanel = item.querySelector('.layer-expand');

    // Select on click
    header.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.layer-drag-handle')) return;
      this._selectedLayerId = layer.id;
      this.render();
      bus.emit(EVENTS.LAYER_SELECTED, layer);
    });

    // Expand on double-click header
    header.addEventListener('dblclick', () => {
      expandPanel.classList.toggle('open');
    });

    // Visibility toggle
    item.querySelector('.layer-visibility').addEventListener('click', (e) => {
      e.stopPropagation();
      layerManager.toggleVisibility(layer.id);
    });

    // Zoom to
    item.querySelector('.btn-zoom').addEventListener('click', (e) => {
      e.stopPropagation();
      layerManager.zoomToLayer(layer.id);
    });

    // Style
    item.querySelector('.btn-style').addEventListener('click', (e) => {
      e.stopPropagation();
      bus.emit(EVENTS.SHOW_SYMBOLOGY, layer);
    });

    // Attribute table
    const tableBtn = item.querySelector('.btn-table');
    if (!tableBtn.disabled) {
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

    // Opacity slider
    const opacitySlider = item.querySelector('.opacity-slider');
    const opacityVal = item.querySelector('.opacity-val');
    opacitySlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      opacityVal.textContent = `${Math.round(val * 100)}%`;
      layerManager.updateLayer(layer.id, { opacity: val });
    });

    // Color swatch click → symbology
    item.querySelector('.layer-swatch').addEventListener('click', () => {
      bus.emit(EVENTS.SHOW_SYMBOLOGY, layer);
    });

    // Drag and drop reorder
    item.addEventListener('dragstart', (e) => {
      this._dragSrc = layer.id;
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      this._container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (this._dragSrc && this._dragSrc !== layer.id) {
        this._reorderLayers(this._dragSrc, layer.id);
      }
    });

    return item;
  }

  _reorderLayers(draggedId, targetId) {
    const layers = layerManager.layers;
    // TOC order is reversed from internal order
    const tocOrder = [...layers].reverse().map(l => l.id);
    const dragIdx = tocOrder.indexOf(draggedId);
    const targetIdx = tocOrder.indexOf(targetId);
    if (dragIdx < 0 || targetIdx < 0) return;
    tocOrder.splice(dragIdx, 1);
    tocOrder.splice(targetIdx, 0, draggedId);
    // Reverse back to internal order
    layerManager.reorderLayers(tocOrder.reverse());
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
