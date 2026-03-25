import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { openModal, closeModal } from './Modal.js';

/**
 * DataCatalog — file-system-browser style project catalog.
 * Renders into #rpanel-catalog-body (right panel tab) instead of a floating panel.
 */
export class DataCatalog {
  constructor() {
    this._selectedLayerId = null;
    this._expandedFolders = new Set(['vector', 'raster', 'services']);

    bus.on(EVENTS.LAYER_ADDED,   () => this._refresh());
    bus.on(EVENTS.LAYER_REMOVED, () => this._refresh());
    bus.on(EVENTS.LAYER_UPDATED, () => this._refresh());
    bus.on(EVENTS.SHOW_DATA_CATALOG, () => this._refresh());
  }

  /** Called by App when catalog tab becomes visible */
  renderInto(container) {
    if (!container) return;
    this._container = container;
    this._render();
  }

  _refresh() {
    if (this._container) this._render();
    // Also re-render if right panel catalog tab is open
    const rpBody = document.getElementById('rpanel-catalog-body');
    if (rpBody && rpBody !== this._container) {
      this._container = rpBody;
      this._render();
    }
  }

  _render() {
    const el = this._container || document.getElementById('rpanel-catalog-body');
    if (!el) return;

    const layers = layerManager.layers;
    const vectorLayers  = layers.filter(l => l.type === 'vector' || l.type === 'esri-feature');
    const rasterLayers  = layers.filter(l => l.type === 'cog' || l.type === 'image' || l.sourceFormat === 'geotiff');
    const serviceLayers = layers.filter(l => ['wms','wmts','xyz','esri-map','wfs'].includes(l.type));

    el.innerHTML = '';

    // File-system tree
    const tree = document.createElement('div');
    tree.className = 'fs-tree';

    const folders = [
      { id: 'vector',   label: 'Data (Vector)', icon: 'folder-vector', layers: vectorLayers,  color: '#60a5fa' },
      { id: 'raster',   label: 'Rasters',        icon: 'folder-raster', layers: rasterLayers,  color: '#34d399' },
      { id: 'services', label: 'Services',        icon: 'folder-svc',    layers: serviceLayers, color: '#fb923c' },
    ];

    for (const f of folders) {
      tree.appendChild(this._buildFolder(f));
    }

    el.appendChild(tree);

    // DB section header
    const dbHeader = document.createElement('div');
    dbHeader.className = 'fs-section-title';
    dbHeader.innerHTML = `<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg> Project Database`;
    el.appendChild(dbHeader);

    const dbList = document.createElement('div');
    dbList.className = 'fs-db-list';
    if (!vectorLayers.length) {
      dbList.innerHTML = '<div class="fs-empty">No vector layers</div>';
    } else {
      for (const layer of vectorLayers) {
        dbList.appendChild(this._buildDBItem(layer));
      }
    }
    el.appendChild(dbList);

    // Wire new layer button in right panel toolbar
    document.getElementById('dc-new-layer-btn')?.addEventListener('click', () => {
      this._showCreateLayerDialog(null);
    });
  }

  _buildFolder(folderDef) {
    const { id, label, layers, color } = folderDef;
    const isOpen = this._expandedFolders.has(id);

    const wrapper = document.createElement('div');
    wrapper.className = 'fs-folder';

    const header = document.createElement('div');
    header.className = `fs-folder-header${isOpen ? ' open' : ''}`;
    header.innerHTML = `
      <span class="fs-arrow">${isOpen ? '▾' : '▸'}</span>
      <span class="fs-folder-icon" style="color:${color}">
        <svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </span>
      <span class="fs-name">${label}</span>
      <span class="fs-count">${layers.length}</span>
    `;

    const children = document.createElement('div');
    children.className = 'fs-children';
    if (!isOpen) children.style.display = 'none';

    if (layers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fs-empty';
      empty.textContent = 'Empty';
      children.appendChild(empty);
    } else {
      for (const layer of layers) {
        children.appendChild(this._buildFileItem(layer));
      }
    }

    header.addEventListener('click', () => {
      const open = children.style.display !== 'none';
      children.style.display = open ? 'none' : 'block';
      header.querySelector('.fs-arrow').textContent = open ? '▸' : '▾';
      header.classList.toggle('open', !open);
      if (open) this._expandedFolders.delete(id);
      else this._expandedFolders.add(id);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(children);
    return wrapper;
  }

  _buildFileItem(layer) {
    const isSelected = this._selectedLayerId === layer.id;
    const item = document.createElement('div');
    item.className = `fs-file${isSelected ? ' selected' : ''}`;
    item.title = layer.name;
    item.innerHTML = `
      <span class="fs-file-icon">${fileIcon(layer)}</span>
      <span class="fs-name">${layer.name}</span>
      <span class="fs-badge">${featureCount(layer)}</span>
    `;

    item.addEventListener('click', () => {
      this._selectedLayerId = layer.id;
      this._refresh();
      bus.emit(EVENTS.LAYER_SELECTED, layer);
      layerManager.zoomToLayer(layer.id);
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showContextMenu(layer, e);
    });

    return item;
  }

  _buildDBItem(layer) {
    const isSelected = this._selectedLayerId === layer.id;
    const schema = layer.metadata?.schema || [];
    const isDB = layer.metadata?.isProjectDB;

    const item = document.createElement('div');
    item.className = `fs-db-item${isSelected ? ' selected' : ''}`;
    item.innerHTML = `
      <span class="fs-db-icon">${geomTypeIcon(layer.geometryType)}</span>
      <span class="fs-name">${layer.name}</span>
      ${isDB ? '<span class="fs-badge db">DB</span>' : ''}
      ${schema.length ? `<span class="fs-badge">${schema.length} fields</span>` : ''}
    `;

    item.addEventListener('click', () => {
      this._selectedLayerId = layer.id;
      this._refresh();
      bus.emit(EVENTS.LAYER_SELECTED, layer);
    });

    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showContextMenu(layer, e);
    });

    return item;
  }

  _showContextMenu(layer, e) {
    this._closeCtxMenu();
    const menu = document.createElement('div');
    menu.className = 'dc-ctx-menu';
    menu.id = 'dc-ctx-menu';
    menu.innerHTML = `
      <div class="dc-ctx-item" data-action="new-point">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg> Create Point Layer…
      </div>
      <div class="dc-ctx-item" data-action="new-line">
        <svg viewBox="0 0 24 24"><polyline points="3,17 7,7 13,13 17,5 21,9"/></svg> Create Line Layer…
      </div>
      <div class="dc-ctx-item" data-action="new-polygon">
        <svg viewBox="0 0 24 24"><polygon points="12,3 20,9 17,19 7,19 4,9"/></svg> Create Polygon Layer…
      </div>
      <div class="ctx-sep"></div>
      <div class="dc-ctx-item" data-action="edit-schema">
        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg> Edit Schema…
      </div>
      <div class="dc-ctx-item danger" data-action="remove">
        <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg> Remove Layer
      </div>
    `;
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
    menu.style.top  = `${Math.min(e.clientY, window.innerHeight - 220)}px`;
    document.body.appendChild(menu);

    menu.querySelectorAll('.dc-ctx-item').forEach(item => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this._closeCtxMenu();
        const a = item.dataset.action;
        if (a === 'new-point')    this._showCreateLayerDialog('Point');
        else if (a === 'new-line')    this._showCreateLayerDialog('LineString');
        else if (a === 'new-polygon') this._showCreateLayerDialog('Polygon');
        else if (a === 'edit-schema') this._showSchemaEditor(layer);
        else if (a === 'remove') {
          if (confirm(`Remove layer "${layer.name}"?`)) layerManager.removeLayer(layer.id);
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
          <thead><tr><th>Field Name</th><th>Type</th><th>Default</th><th title="Required">Req</th><th title="UUID">UUID</th><th></th></tr></thead>
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
        <td><input type="text" placeholder="field_name"></td>
        <td><select>${['String','Number','Integer','Boolean','Date'].map(t=>`<option>${t}</option>`).join('')}</select></td>
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
          type: row.querySelector('select')?.value || 'String',
          defaultValue: inputs[1]?.value || '',
          required: row.querySelector('.req-chk')?.checked || false,
          isUUID: row.querySelector('.uuid-chk')?.checked || false,
        });
      });
      closeModal();
      layerManager.addLayer({ name, type: 'vector', geometryType: geomType, data: { type: 'FeatureCollection', features: [] }, metadata: { schema, isProjectDB: true } });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Created: ${name}` });
    });
  }

  _showSchemaEditor(layer) {
    const existing = layer.metadata?.schema || [];
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group"><label class="form-label">Layer: ${layer.name}</label></div>
      <div style="overflow-x:auto">
        <table class="schema-table">
          <thead><tr><th>Field Name</th><th>Type</th><th>Default</th><th>Req</th><th>UUID</th><th></th></tr></thead>
          <tbody id="dc-edit-schema-body"></tbody>
        </table>
      </div>
      <button class="btn btn-secondary" id="dc-edit-add-field" style="margin-top:6px;font-size:11px">+ Add Field</button>
    `;
    const footer = document.createElement('div');
    footer.innerHTML = `<button class="btn btn-ghost" id="dc-edit-cancel">Cancel</button><button class="btn btn-primary" id="dc-edit-save">Save Schema</button>`;
    openModal({ title: `Edit Schema — ${layer.name}`, content, footer, width: 520 });

    const schemaBody = document.getElementById('dc-edit-schema-body');
    const addFieldRow = (field) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="text" placeholder="field_name" value="${field?.name || ''}"></td>
        <td><select>${['String','Number','Integer','Boolean','Date'].map(t=>`<option ${(field?.type||'String')===t?'selected':''}>${t}</option>`).join('')}</select></td>
        <td><input type="text" placeholder="default" value="${field?.defaultValue || ''}"></td>
        <td style="text-align:center"><input type="checkbox" class="req-chk" ${field?.required?'checked':''}></td>
        <td style="text-align:center"><input type="checkbox" class="uuid-chk" ${field?.isUUID?'checked':''}></td>
        <td><button class="btn btn-ghost" style="padding:2px 6px;font-size:11px" data-rm>✕</button></td>
      `;
      row.querySelector('[data-rm]').addEventListener('click', () => row.remove());
      schemaBody.appendChild(row);
    };
    for (const f of existing) addFieldRow(f);
    document.getElementById('dc-edit-add-field').addEventListener('click', () => addFieldRow(null));
    document.getElementById('dc-edit-cancel').addEventListener('click', closeModal);
    document.getElementById('dc-edit-save').addEventListener('click', () => {
      const schema = [];
      schemaBody.querySelectorAll('tr').forEach(row => {
        const inputs = row.querySelectorAll('td input[type=text]');
        const fieldName = inputs[0]?.value?.trim();
        if (!fieldName) return;
        schema.push({ name: fieldName, type: row.querySelector('select')?.value||'String', defaultValue: inputs[1]?.value||'', required: row.querySelector('.req-chk')?.checked||false, isUUID: row.querySelector('.uuid-chk')?.checked||false });
      });
      closeModal();
      layerManager.updateLayer(layer.id, { metadata: { ...layer.metadata, schema } });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Schema updated' });
    });
  }
}

// ---- Helpers ----
function fileIcon(layer) {
  const gt = layer.geometryType;
  if (layer.type === 'vector' || layer.type === 'esri-feature') {
    if (gt === 'Polygon')    return '<svg viewBox="0 0 24 24" style="color:#a78bfa"><polygon points="12,3 20,9 17,19 7,19 4,9" fill="currentColor" opacity="0.7"/></svg>';
    if (gt === 'LineString') return '<svg viewBox="0 0 24 24" style="color:#f97316"><polyline points="3,17 7,7 13,13 17,5 21,9" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
    return '<svg viewBox="0 0 24 24" style="color:#60a5fa"><circle cx="12" cy="12" r="6" fill="currentColor" opacity="0.8"/></svg>';
  }
  if (layer.type === 'cog' || layer.type === 'image' || layer.sourceFormat === 'geotiff')
    return '<svg viewBox="0 0 24 24" style="color:#34d399"><rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  return '<svg viewBox="0 0 24 24" style="color:#fb923c"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2"/></svg>';
}

function geomTypeIcon(geomType) {
  if (geomType === 'Polygon')    return '<svg viewBox="0 0 24 24" style="color:#a78bfa;width:12px;height:12px"><polygon points="12,3 20,9 17,19 7,19 4,9" fill="currentColor"/></svg>';
  if (geomType === 'LineString') return '<svg viewBox="0 0 24 24" style="color:#f97316;width:12px;height:12px"><polyline points="3,17 7,7 13,13 17,5 21,9" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>';
  return '<svg viewBox="0 0 24 24" style="color:#60a5fa;width:12px;height:12px"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>';
}

function featureCount(layer) {
  const n = layer.data?.features?.length;
  if (n === undefined) return '';
  return n > 999 ? `${(n/1000).toFixed(1)}k` : String(n);
}

export const dataCatalog = new DataCatalog();
