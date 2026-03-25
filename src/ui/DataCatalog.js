import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { openModal, closeModal } from './Modal.js';

/**
 * DataCatalog — filesystem-style browser rendered into a container element.
 * Designed for use inside RightPanel's Catalog tab.
 */
export class DataCatalog {
  constructor() {
    this._container = null;
    this._selectedLayerId = null;
    this._expandedFolders = new Set(['vectors', 'rasters', 'services']);

    bus.on(EVENTS.LAYER_ADDED,   () => this._refresh());
    bus.on(EVENTS.LAYER_REMOVED, () => this._refresh());
    bus.on(EVENTS.LAYER_UPDATED, () => this._refresh());
    // Legacy: handle SHOW_DATA_CATALOG event (toolbar button)
    bus.on(EVENTS.SHOW_DATA_CATALOG, () => {
      window._rightPanel?.switchTab('catalog');
      window._rightPanel?._expand();
    });
  }

  /** Render catalog tree into the given container element */
  renderInto(container) {
    this._container = container;
    this._render();
  }

  _refresh() {
    if (this._container) this._render();
  }

  _render() {
    if (!this._container) return;
    const layers = layerManager.layers;

    const vectorLayers  = layers.filter(l => l.type === 'vector' || l.type === 'esri-feature');
    const rasterLayers  = layers.filter(l => l.type === 'cog' || l.type === 'image' || l.sourceFormat === 'geotiff');
    const serviceLayers = layers.filter(l => ['wms', 'wmts', 'xyz', 'esri-map', 'wfs'].includes(l.type));

    this._container.innerHTML = `
      <div class="catalog-toolbar">
        <button class="catalog-toolbar-btn" id="cat-new-layer" title="New vector layer">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          New Layer
        </button>
      </div>
      <div class="catalog-tree" id="cat-tree"></div>
    `;

    const tree = this._container.querySelector('#cat-tree');

    // Project root
    const root = this._buildFolderNode('project', '📁 Project', [
      this._buildFolderNode('vectors',  '📂 Data (Vector)',  vectorLayers,  l => this._buildLayerNode(l, 'vector')),
      this._buildFolderNode('rasters',  '📂 Rasters',        rasterLayers,  l => this._buildLayerNode(l, 'raster')),
      this._buildFolderNode('services', '📂 Services',       serviceLayers, l => this._buildLayerNode(l, 'service')),
    ]);
    tree.appendChild(root);

    // New layer button
    this._container.querySelector('#cat-new-layer')?.addEventListener('click', () => {
      this._showCreateLayerDialog(null);
    });

    // Close context menus on outside click
    document.addEventListener('click', () => this._closeCtxMenu(), true);
  }

  /**
   * Build a folder node in the tree.
   * @param {string} key - unique key for expand/collapse tracking
   * @param {string} label - folder display label
   * @param {Array} items - either sub-nodes (HTMLElement[]) or data items
   * @param {Function} [itemBuilder] - if items are data, how to build each node
   */
  _buildFolderNode(key, label, items, itemBuilder) {
    const isOpen = this._expandedFolders.has(key);
    const div = document.createElement('div');
    div.className = 'cat-folder';
    div.dataset.folderKey = key;

    const header = document.createElement('div');
    header.className = 'cat-folder-header';
    const count = itemBuilder ? items.length : items.filter(i => i instanceof HTMLElement).length;

    header.innerHTML = `
      <span class="cat-chevron">${isOpen ? '▾' : '▸'}</span>
      <span class="cat-folder-icon">${label.split(' ')[0]}</span>
      <span class="cat-folder-name">${label.split(' ').slice(1).join(' ')}</span>
      <span class="cat-count">${itemBuilder ? items.length : ''}</span>
    `;
    div.appendChild(header);

    const children = document.createElement('div');
    children.className = 'cat-children';
    children.style.display = isOpen ? 'block' : 'none';

    if (itemBuilder) {
      // Data items
      if (items.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'cat-empty';
        empty.textContent = 'Empty';
        children.appendChild(empty);
      } else {
        items.forEach(item => children.appendChild(itemBuilder(item)));
      }
    } else {
      // Sub-folder nodes
      items.forEach(node => { if (node) children.appendChild(node); });
    }
    div.appendChild(children);

    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = children.style.display !== 'none';
      children.style.display = open ? 'none' : 'block';
      header.querySelector('.cat-chevron').textContent = open ? '▸' : '▾';
      if (open) this._expandedFolders.delete(key);
      else this._expandedFolders.add(key);
    });

    return div;
  }

  /** Build a leaf node for a layer */
  _buildLayerNode(layer, kind) {
    const isSelected = this._selectedLayerId === layer.id;
    const div = document.createElement('div');
    div.className = `cat-item${isSelected ? ' selected' : ''}`;
    div.dataset.layerId = layer.id;

    const icon = kind === 'vector' ? geomIcon(layer.geometryType)
               : kind === 'raster' ? '🗺'
               : '🌐';

    div.innerHTML = `
      <span class="cat-file-icon">${icon}</span>
      <span class="cat-item-name" title="${layer.name}">${layer.name}</span>
      <span class="cat-item-actions">
        <button class="cat-action-btn cat-zoom" title="Zoom to layer">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <button class="cat-action-btn cat-style" title="Open symbology">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/></svg>
        </button>
      </span>
    `;

    div.addEventListener('click', (e) => {
      if (e.target.closest('.cat-action-btn')) return;
      this._selectedLayerId = layer.id;
      this._container?.querySelectorAll('.cat-item').forEach(el => el.classList.remove('selected'));
      div.classList.add('selected');
      bus.emit(EVENTS.LAYER_SELECTED, layer);
    });

    div.querySelector('.cat-zoom')?.addEventListener('click', (e) => {
      e.stopPropagation();
      layerManager.zoomToLayer(layer.id);
    });

    div.querySelector('.cat-style')?.addEventListener('click', (e) => {
      e.stopPropagation();
      bus.emit(EVENTS.SHOW_SYMBOLOGY, layer);
    });

    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showContextMenu(layer, e);
    });

    return div;
  }

  _showContextMenu(layer, e) {
    this._closeCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'dc-ctx-menu';
    menu.id = 'dc-ctx-menu';
    menu.innerHTML = `
      <div class="dc-ctx-item" data-action="zoom">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/></svg> Zoom to Layer
      </div>
      <div class="dc-ctx-item" data-action="symbology">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg> Symbology
      </div>
      ${(layer.type === 'vector' || layer.type === 'esri-feature') ? `
      <div class="dc-ctx-item" data-action="edit-schema">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/></svg> Edit Schema
      </div>
      ` : ''}
      <div class="dc-ctx-sep"></div>
      <div class="dc-ctx-item danger" data-action="remove">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg> Remove Layer
      </div>
    `;
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
    menu.style.top  = `${Math.min(e.clientY, window.innerHeight - 180)}px`;
    document.body.appendChild(menu);

    menu.querySelectorAll('.dc-ctx-item').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._closeCtxMenu();
        const action = item.dataset.action;
        if (action === 'zoom') layerManager.zoomToLayer(layer.id);
        else if (action === 'symbology') bus.emit(EVENTS.SHOW_SYMBOLOGY, layer);
        else if (action === 'edit-schema') this._showSchemaEditor(layer);
        else if (action === 'remove') {
          if (confirm(`Remove "${layer.name}"?`)) layerManager.removeLayer(layer.id);
        }
      });
    });

    setTimeout(() => document.addEventListener('click', () => this._closeCtxMenu(), { once: true }), 0);
  }

  _closeCtxMenu() {
    document.getElementById('dc-ctx-menu')?.remove();
  }

  _showCreateLayerDialog(geometryType) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Layer Name</label>
        <input type="text" class="form-input" id="dc-layer-name" value="New ${geometryType || 'Vector'} Layer">
      </div>
      <div class="form-group">
        <label class="form-label">Geometry Type</label>
        <select class="form-select" id="dc-geom-type">
          <option value="Point"      ${geometryType === 'Point'      ? 'selected' : ''}>Point</option>
          <option value="LineString" ${geometryType === 'LineString' ? 'selected' : ''}>LineString</option>
          <option value="Polygon"    ${geometryType === 'Polygon'    ? 'selected' : ''}>Polygon</option>
        </select>
      </div>
      <div class="dc-section-title" style="padding:8px 0 4px">Schema Fields</div>
      <div style="overflow-x:auto">
        <table class="schema-table">
          <thead><tr>
            <th>Field Name</th><th>Type</th><th>Default</th>
            <th title="Required">Req</th><th title="UUID">UUID</th><th></th>
          </tr></thead>
          <tbody id="dc-schema-body"></tbody>
        </table>
      </div>
      <button class="btn btn-secondary" id="dc-add-field" style="margin-top:6px;font-size:11px">+ Add Field</button>
    `;
    const footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn-ghost" id="dc-cancel">Cancel</button>
      <button class="btn btn-primary" id="dc-create">Create Layer</button>
    `;
    openModal({ title: 'Create New Layer', content, footer, width: 520 });

    const schemaBody = document.getElementById('dc-schema-body');
    const addField = () => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="text" placeholder="field_name" value=""></td>
        <td><select><option>String</option><option>Number</option><option>Integer</option><option>Boolean</option><option>Date</option></select></td>
        <td><input type="text" placeholder="default"></td>
        <td style="text-align:center"><input type="checkbox" class="req-chk"></td>
        <td style="text-align:center"><input type="checkbox" class="uuid-chk"></td>
        <td><button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" data-rm>✕</button></td>
      `;
      row.querySelector('[data-rm]').addEventListener('click', () => row.remove());
      schemaBody.appendChild(row);
    };
    document.getElementById('dc-add-field').addEventListener('click', addField);
    addField();
    document.getElementById('dc-cancel').addEventListener('click', closeModal);
    document.getElementById('dc-create').addEventListener('click', () => {
      const name = document.getElementById('dc-layer-name')?.value?.trim() || 'New Layer';
      const geomType = document.getElementById('dc-geom-type')?.value || 'Point';
      const schema = [];
      schemaBody.querySelectorAll('tr').forEach(row => {
        const inputs = row.querySelectorAll('td input[type=text]');
        const fieldName = inputs[0]?.value?.trim();
        if (!fieldName) return;
        schema.push({
          name: fieldName,
          type: row.querySelector('td select')?.value || 'String',
          defaultValue: inputs[1]?.value || '',
          required: row.querySelector('.req-chk')?.checked || false,
          isUUID: row.querySelector('.uuid-chk')?.checked || false,
        });
      });
      closeModal();
      layerManager.addLayer({
        name, type: 'vector', geometryType: geomType,
        data: { type: 'FeatureCollection', features: [] },
        metadata: { schema, isProjectDB: true },
      });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Created layer: ${name}` });
    });
  }

  _showSchemaEditor(layer) {
    const existing = layer.metadata?.schema || [];
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group"><label class="form-label">Layer: ${layer.name}</label></div>
      <div style="overflow-x:auto">
        <table class="schema-table">
          <thead><tr>
            <th>Field Name</th><th>Type</th><th>Default</th>
            <th title="Required">Req</th><th title="UUID">UUID</th><th></th>
          </tr></thead>
          <tbody id="dc-edit-schema-body"></tbody>
        </table>
      </div>
      <button class="btn btn-secondary" id="dc-edit-add-field" style="margin-top:6px;font-size:11px">+ Add Field</button>
    `;
    const footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn-ghost" id="dc-edit-cancel">Cancel</button>
      <button class="btn btn-primary" id="dc-edit-save">Save Schema</button>
    `;
    openModal({ title: `Edit Schema — ${layer.name}`, content, footer, width: 520 });

    const schemaBody = document.getElementById('dc-edit-schema-body');
    const addFieldRow = (field) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="text" placeholder="field_name" value="${field?.name || ''}"></td>
        <td><select>${['String','Number','Integer','Boolean','Date'].map(t =>
          `<option ${(field?.type || 'String') === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input type="text" placeholder="default" value="${field?.defaultValue || ''}"></td>
        <td style="text-align:center"><input type="checkbox" class="req-chk" ${field?.required?'checked':''}></td>
        <td style="text-align:center"><input type="checkbox" class="uuid-chk" ${field?.isUUID?'checked':''}></td>
        <td><button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" data-rm>✕</button></td>
      `;
      row.querySelector('[data-rm]').addEventListener('click', () => row.remove());
      schemaBody.appendChild(row);
    };
    for (const field of existing) addFieldRow(field);
    document.getElementById('dc-edit-add-field').addEventListener('click', () => addFieldRow(null));
    document.getElementById('dc-edit-cancel').addEventListener('click', closeModal);
    document.getElementById('dc-edit-save').addEventListener('click', () => {
      const schema = [];
      schemaBody.querySelectorAll('tr').forEach(row => {
        const inputs = row.querySelectorAll('td input[type=text]');
        const fieldName = inputs[0]?.value?.trim();
        if (!fieldName) return;
        schema.push({
          name: fieldName,
          type: row.querySelector('td select')?.value || 'String',
          defaultValue: inputs[1]?.value || '',
          required: row.querySelector('.req-chk')?.checked || false,
          isUUID: row.querySelector('.uuid-chk')?.checked || false,
        });
      });
      closeModal();
      layerManager.updateLayer(layer.id, { metadata: { ...layer.metadata, schema } });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Schema updated' });
    });
  }

  // Legacy: keep open() for backward compat
  open() {
    window._rightPanel?.switchTab('catalog');
    window._rightPanel?._expand();
  }
}

function geomIcon(geomType) {
  if (geomType === 'Polygon') return '◼';
  if (geomType === 'LineString') return '╱';
  return '●';
}

export const dataCatalog = new DataCatalog();
