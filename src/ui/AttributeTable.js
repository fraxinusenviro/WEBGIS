import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { openModal, closeModal } from './Modal.js';
import { exportManager } from '../io/ExportManager.js';

/**
 * AttributeTable — tabular view of feature attributes
 */
export class AttributeTable {
  constructor() {
    bus.on(EVENTS.SHOW_ATTR_TABLE, (layer) => this.open(layer));
  }

  open(layer) {
    if (!layer?.data?.features?.length) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'No features to display' });
      return;
    }

    const content = document.createElement('div');
    this._buildTable(content, layer);

    openModal({
      title: `Attribute Table — ${layer.name} (${layer.data.features.length} features)`,
      content,
      width: 700,
    });
  }

  _buildTable(container, layer) {
    const features = layer.data.features;
    if (!features.length) return;

    const allKeys = new Set();
    features.forEach(f => Object.keys(f.properties || {}).forEach(k => allKeys.add(k)));
    const keys = Array.from(allKeys);

    // Search / filter
    container.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
        <input type="text" class="form-input" id="attr-search" placeholder="Search…" style="flex:1">
        <button class="btn btn-secondary" id="attr-export-csv">Export CSV</button>
        <button class="btn btn-secondary" id="attr-export-geojson">Export GeoJSON</button>
      </div>
      <div class="attr-table-wrap">
        <table class="attr-table" id="attr-table">
          <thead>
            <tr>
              <th style="width:40px">#</th>
              ${keys.map(k => `<th data-key="${k}">${k}</th>`).join('')}
            </tr>
          </thead>
          <tbody id="attr-tbody">
          </tbody>
        </table>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text-muted)" id="attr-status">
        ${features.length} features, ${keys.length} fields
      </div>
    `;

    let sortKey = null;
    let sortDir = 1;
    let filtered = [...features];

    const renderRows = (rows) => {
      const tbody = container.querySelector('#attr-tbody');
      tbody.innerHTML = rows.slice(0, 1000).map((f, i) => `
        <tr data-index="${i}">
          <td style="color:var(--text-muted);font-size:11px">${i+1}</td>
          ${keys.map(k => {
            const v = f.properties?.[k];
            const str = v === null || v === undefined ? '' : String(v);
            return `<td title="${str}">${str.length > 40 ? str.slice(0, 40) + '…' : str}</td>`;
          }).join('')}
        </tr>
      `).join('');
      container.querySelector('#attr-status').textContent = `${rows.length} features${rows.length > 1000 ? ' (showing first 1000)' : ''}, ${keys.length} fields`;
    };

    renderRows(filtered);

    // Search
    container.querySelector('#attr-search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      filtered = features.filter(f => {
        if (!q) return true;
        return Object.values(f.properties || {}).some(v => String(v).toLowerCase().includes(q));
      });
      if (sortKey) filtered.sort((a, b) => {
        const av = a.properties?.[sortKey] ?? '';
        const bv = b.properties?.[sortKey] ?? '';
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sortDir;
      });
      renderRows(filtered);
    });

    // Sort on header click
    container.querySelector('#attr-table thead').addEventListener('click', (e) => {
      const th = e.target.closest('th[data-key]');
      if (!th) return;
      const key = th.dataset.key;
      if (sortKey === key) { sortDir *= -1; }
      else { sortKey = key; sortDir = 1; }
      filtered.sort((a, b) => {
        const av = a.properties?.[key] ?? '';
        const bv = b.properties?.[key] ?? '';
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * sortDir;
      });
      renderRows(filtered);
    });

    // Highlight on row click
    container.querySelector('#attr-tbody').addEventListener('click', (e) => {
      const row = e.target.closest('tr');
      if (!row) return;
      container.querySelectorAll('#attr-tbody tr').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
    });

    // Export buttons
    container.querySelector('#attr-export-csv').addEventListener('click', () => {
      exportManager.exportCSV(layer.id);
    });
    container.querySelector('#attr-export-geojson').addEventListener('click', () => {
      exportManager.exportGeoJSON(layer.id);
    });
  }
}
