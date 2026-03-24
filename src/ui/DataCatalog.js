import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { openModal, closeModal } from './Modal.js';

/**
 * DataCatalog — project structure and database management panel
 */
export class DataCatalog {
  constructor() {
    this._panel = null;
    this._selectedLayerId = null;

    bus.on(EVENTS.LAYER_ADDED, () => this._refresh());
    bus.on(EVENTS.LAYER_REMOVED, () => this._refresh());
    bus.on(EVENTS.LAYER_UPDATED, () => this._refresh());
    bus.on(EVENTS.SHOW_DATA_CATALOG, () => this.open());
  }

  open() {
    if (this._panel) {
      this._panel.classList.toggle('hidden');
      if (!this._panel.classList.contains('hidden')) this._render();
      return;
    }

    this._panel = document.createElement('div');
    this._panel.className = 'data-catalog-panel';
    this._panel.style.cssText = `
      position: fixed;
      top: 48px;
      right: 0;
      width: 320px;
      height: calc(100vh - 48px);
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      z-index: 200;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    `;

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid var(--border);flex-shrink:0';
    header.innerHTML = `
      <span style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-secondary)">Data Catalog</span>
      <button class="panel-btn" id="dc-close" title="Close">✕</button>
    `;
    this._panel.appendChild(header);

    const body = document.createElement('div');
    body.id = 'dc-body';
    body.style.cssText = 'flex:1;overflow-y:auto;padding:8px';
    this._panel.appendChild(body);

    document.body.appendChild(this._panel);

    this._panel.querySelector('#dc-close').addEventListener('click', () => {
      this._panel.classList.add('hidden');
    });

    // Close context menus on click outside
    document.addEventListener('click', () => this._closeCtxMenu(), true);

    this._render();
  }

  _refresh() {
    if (this._panel && !this._panel.classList.contains('hidden')) {
      this._render();
    }
  }

  _render() {
    const body = this._panel?.querySelector('#dc-body');
    if (!body) return;

    const layers = layerManager.layers;
    const vectorLayers = layers.filter(l => l.type === 'vector' || l.type === 'esri-feature');
    const rasterLayers = layers.filter(l => l.type === 'cog' || l.type === 'image' || l.sourceFormat === 'geotiff');
    const serviceLayers = layers.filter(l => ['wms', 'wmts', 'xyz', 'esri-map', 'wfs'].includes(l.type));

    body.innerHTML = `
      <div class="dc-section-title">Project Structure</div>
      <ul class="data-catalog-tree" id="dc-tree"></ul>
      <div class="dc-section-title" style="margin-top:12px">Project Database</div>
      <ul class="data-catalog-tree" id="dc-db-tree"></ul>
      <div style="margin-top:8px">
        <button class="btn btn-secondary" id="dc-new-layer" style="width:100%;font-size:11px">
          + New Vector Layer...
        </button>
      </div>
    `;

    // Build project structure tree
    const tree = body.querySelector('#dc-tree');

    const folders = [
      { label: 'Data (Vector)', icon: '⬡', layers: vectorLayers },
      { label: 'Rasters', icon: '▦', layers: rasterLayers },
      { label: 'Services', icon: '⊕', layers: serviceLayers },
    ];

    for (const folder of folders) {
      const folderEl = this._buildFolder(folder.label, folder.icon, folder.layers);
      tree.appendChild(folderEl);
    }

    // Build project database tree (vector layers with schema)
    const dbTree = body.querySelector('#dc-db-tree');
    if (!vectorLayers.length) {
      const empty = document.createElement('li');
      empty.style.cssText = 'font-size:11px;color:var(--text-muted);padding:6px 8px';
      empty.textContent = 'No vector layers';
      dbTree.appendChild(empty);
    } else {
      for (const layer of vectorLayers) {
        const item = this._buildDBLayerItem(layer);
        dbTree.appendChild(item);
      }
    }

    // New layer button
    body.querySelector('#dc-new-layer').addEventListener('click', () => {
      this._showCreateLayerDialog(null);
    });
  }

  _buildFolder(label, icon, layers) {
    const li = document.createElement('li');
    li.className = 'dc-folder';

    const isOpen = layers.length > 0;
    li.innerHTML = `
      <div class="dc-folder-header">
        <span>${isOpen ? '▾' : '▸'}</span>
        <span>${icon}</span>
        <span>${label}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted)">${layers.length}</span>
      </div>
      <ul class="data-catalog-tree dc-folder-children" style="${isOpen ? '' : 'display:none'}">
        ${layers.length === 0 ? '<li style="font-size:11px;color:var(--text-muted);padding:3px 8px">Empty</li>' : ''}
      </ul>
    `;

    const childrenEl = li.querySelector('.dc-folder-children');
    const headerEl = li.querySelector('.dc-folder-header');
    const arrow = headerEl.querySelector('span:first-child');

    for (const layer of layers) {
      const item = this._buildFolderLayerItem(layer);
      childrenEl.appendChild(item);
    }

    headerEl.addEventListener('click', () => {
      const visible = childrenEl.style.display !== 'none';
      childrenEl.style.display = visible ? 'none' : 'block';
      arrow.textContent = visible ? '▸' : '▾';
    });

    return li;
  }

  _buildFolderLayerItem(layer) {
    const li = document.createElement('li');
    li.className = `dc-layer-item${this._selectedLayerId === layer.id ? ' selected' : ''}`;
    li.textContent = layer.name;

    li.addEventListener('click', () => {
      this._selectedLayerId = layer.id;
      this._refresh();
      bus.emit(EVENTS.LAYER_SELECTED, layer);
      layerManager.zoomToLayer(layer.id);
    });

    return li;
  }

  _buildDBLayerItem(layer) {
    const li = document.createElement('li');
    li.className = `dc-layer-item${this._selectedLayerId === layer.id ? ' selected' : ''}`;
    li.dataset.layerId = layer.id;

    const hasSchema = layer.metadata?.schema?.length > 0;
    const isProjectDB = layer.metadata?.isProjectDB === true;

    li.innerHTML = `
      <span style="font-size:10px;margin-right:4px;color:var(--text-muted)">${geomTypeIcon(layer.geometryType)}</span>
      <span style="flex:1">${layer.name}</span>
      ${isProjectDB ? '<span style="font-size:9px;color:var(--accent);margin-left:4px">DB</span>' : ''}
      ${hasSchema ? `<span style="font-size:9px;color:var(--text-muted);margin-left:4px">${layer.metadata.schema.length} fields</span>` : ''}
    `;

    li.addEventListener('click', () => {
      this._selectedLayerId = layer.id;
      this._refresh();
      bus.emit(EVENTS.LAYER_SELECTED, layer);
    });

    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._showContextMenu(layer, e);
    });

    return li;
  }

  _showContextMenu(layer, e) {
    this._closeCtxMenu();

    const menu = document.createElement('div');
    menu.className = 'dc-ctx-menu';
    menu.id = 'dc-ctx-menu';
    menu.innerHTML = `
      <div class="dc-ctx-item" data-action="new-point">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>
        Create New Point Layer...
      </div>
      <div class="dc-ctx-item" data-action="new-line">
        <svg viewBox="0 0 24 24"><polyline points="3,17 7,7 13,13 17,5 21,9"/></svg>
        Create New Line Layer...
      </div>
      <div class="dc-ctx-item" data-action="new-polygon">
        <svg viewBox="0 0 24 24"><polygon points="12,3 20,9 17,19 7,19 4,9"/></svg>
        Create New Polygon Layer...
      </div>
      <div style="border-top:1px solid var(--border);margin:4px 0"></div>
      <div class="dc-ctx-item" data-action="edit-schema">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        Edit Schema...
      </div>
      <div class="dc-ctx-item" data-action="remove" style="color:var(--danger)">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        Remove Layer
      </div>
    `;

    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
    document.body.appendChild(menu);

    menu.querySelectorAll('.dc-ctx-item').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._closeCtxMenu();
        const action = item.dataset.action;
        if (action === 'new-point') this._showCreateLayerDialog('Point');
        else if (action === 'new-line') this._showCreateLayerDialog('LineString');
        else if (action === 'new-polygon') this._showCreateLayerDialog('Polygon');
        else if (action === 'edit-schema') this._showSchemaEditor(layer);
        else if (action === 'remove') {
          if (confirm(`Remove layer "${layer.name}"?`)) layerManager.removeLayer(layer.id);
        }
      });
    });
  }

  _closeCtxMenu() {
    const existing = document.getElementById('dc-ctx-menu');
    if (existing) existing.remove();
  }

  _showCreateLayerDialog(geometryType) {
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Layer Name</label>
        <input type="text" class="form-input" id="dc-layer-name" placeholder="New Layer" value="New ${geometryType || 'Vector'} Layer">
      </div>
      <div class="form-group">
        <label class="form-label">Geometry Type</label>
        <select class="form-select" id="dc-geom-type">
          <option value="Point" ${geometryType === 'Point' ? 'selected' : ''}>Point</option>
          <option value="LineString" ${geometryType === 'LineString' ? 'selected' : ''}>LineString</option>
          <option value="Polygon" ${geometryType === 'Polygon' ? 'selected' : ''}>Polygon</option>
        </select>
      </div>
      <div class="dc-section-title" style="padding:8px 0 4px">Schema Fields</div>
      <div style="overflow-x:auto">
        <table class="schema-table">
          <thead>
            <tr>
              <th>Field Name</th>
              <th>Type</th>
              <th>Default</th>
              <th title="Required">Req</th>
              <th title="UUID Auto-field">UUID</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="dc-schema-body">
          </tbody>
        </table>
      </div>
      <button class="btn btn-secondary btn-add-field" id="dc-add-field">+ Add Field</button>
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
        <td>
          <select>
            <option>String</option>
            <option>Number</option>
            <option>Integer</option>
            <option>Boolean</option>
            <option>Date</option>
          </select>
        </td>
        <td><input type="text" placeholder="default"></td>
        <td style="text-align:center"><input type="checkbox" class="req-chk"></td>
        <td style="text-align:center"><input type="checkbox" class="uuid-chk"></td>
        <td><button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" data-action="remove-row">✕</button></td>
      `;
      row.querySelector('[data-action="remove-row"]').addEventListener('click', () => row.remove());
      schemaBody.appendChild(row);
    };

    document.getElementById('dc-add-field').addEventListener('click', addField);
    // Add one default field
    addField();

    document.getElementById('dc-cancel').addEventListener('click', closeModal);

    document.getElementById('dc-create').addEventListener('click', () => {
      const name = document.getElementById('dc-layer-name')?.value?.trim() || 'New Layer';
      const geomType = document.getElementById('dc-geom-type')?.value || 'Point';

      const schema = [];
      schemaBody.querySelectorAll('tr').forEach(row => {
        const inputs = row.querySelectorAll('td input[type=text]');
        const selects = row.querySelectorAll('td select');
        const fieldName = inputs[0]?.value?.trim();
        if (!fieldName) return;
        schema.push({
          name: fieldName,
          type: selects[0]?.value || 'String',
          defaultValue: inputs[1]?.value || '',
          required: row.querySelector('.req-chk')?.checked || false,
          isUUID: row.querySelector('.uuid-chk')?.checked || false,
        });
      });

      closeModal();

      layerManager.addLayer({
        name,
        type: 'vector',
        geometryType: geomType,
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
      <div class="form-group">
        <label class="form-label">Layer: ${layer.name}</label>
      </div>
      <div style="overflow-x:auto">
        <table class="schema-table">
          <thead>
            <tr>
              <th>Field Name</th>
              <th>Type</th>
              <th>Default</th>
              <th title="Required">Req</th>
              <th title="UUID Auto-field">UUID</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="dc-edit-schema-body"></tbody>
        </table>
      </div>
      <button class="btn btn-secondary btn-add-field" id="dc-edit-add-field">+ Add Field</button>
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
        <td>
          <select>
            ${['String','Number','Integer','Boolean','Date'].map(t =>
              `<option ${(field?.type || 'String') === t ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
        </td>
        <td><input type="text" placeholder="default" value="${field?.defaultValue || ''}"></td>
        <td style="text-align:center"><input type="checkbox" class="req-chk" ${field?.required ? 'checked' : ''}></td>
        <td style="text-align:center"><input type="checkbox" class="uuid-chk" ${field?.isUUID ? 'checked' : ''}></td>
        <td><button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" data-action="remove-row">✕</button></td>
      `;
      row.querySelector('[data-action="remove-row"]').addEventListener('click', () => row.remove());
      schemaBody.appendChild(row);
    };

    for (const field of existing) addFieldRow(field);

    document.getElementById('dc-edit-add-field').addEventListener('click', () => addFieldRow(null));
    document.getElementById('dc-edit-cancel').addEventListener('click', closeModal);

    document.getElementById('dc-edit-save').addEventListener('click', () => {
      const schema = [];
      schemaBody.querySelectorAll('tr').forEach(row => {
        const inputs = row.querySelectorAll('td input[type=text]');
        const selects = row.querySelectorAll('td select');
        const fieldName = inputs[0]?.value?.trim();
        if (!fieldName) return;
        schema.push({
          name: fieldName,
          type: selects[0]?.value || 'String',
          defaultValue: inputs[1]?.value || '',
          required: row.querySelector('.req-chk')?.checked || false,
          isUUID: row.querySelector('.uuid-chk')?.checked || false,
        });
      });

      closeModal();
      layerManager.updateLayer(layer.id, {
        metadata: { ...layer.metadata, schema },
      });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Schema updated' });
    });
  }
}

function geomTypeIcon(geomType) {
  if (geomType === 'Polygon') return '▬';
  if (geomType === 'LineString') return '╱';
  return '●';
}

export const dataCatalog = new DataCatalog();
