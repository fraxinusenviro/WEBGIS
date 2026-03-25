import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { closeModal } from './Modal.js';

const COLOR_RAMPS = {
  sequential_green: ['#f7fcf5','#c7e9c0','#74c476','#238b45','#00441b'],
  sequential_blue:  ['#f7fbff','#c6dbef','#6baed6','#2171b5','#084594'],
  sequential_red:   ['#fff5f0','#fcbba1','#fb6a4a','#cb181d','#67000d'],
  diverging_rygb:   ['#d73027','#fc8d59','#fee090','#91bfdb','#4575b4'],
  qualitative:      ['#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00','#ffff33','#a65628','#f781bf'],
};

// Point symbols supported
export const POINT_SYMBOLS = [
  { id: 'circle',   label: 'Circle',   svg: `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="currentColor"/></svg>` },
  { id: 'square',   label: 'Square',   svg: `<svg viewBox="0 0 20 20"><rect x="3" y="3" width="14" height="14" rx="1" fill="currentColor"/></svg>` },
  { id: 'triangle', label: 'Triangle', svg: `<svg viewBox="0 0 20 20"><polygon points="10,2 18,18 2,18" fill="currentColor"/></svg>` },
  { id: 'diamond',  label: 'Diamond',  svg: `<svg viewBox="0 0 20 20"><polygon points="10,1 19,10 10,19 1,10" fill="currentColor"/></svg>` },
  { id: 'cross',    label: 'Cross',    svg: `<svg viewBox="0 0 20 20"><rect x="8" y="1" width="4" height="18" fill="currentColor"/><rect x="1" y="8" width="18" height="4" fill="currentColor"/></svg>` },
  { id: 'x',        label: 'X',        svg: `<svg viewBox="0 0 20 20"><line x1="2" y1="2" x2="18" y2="18" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><line x1="18" y1="2" x2="2" y2="18" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>` },
  { id: 'star',     label: 'Star',     svg: `<svg viewBox="0 0 20 20"><polygon points="10,1 12.9,7 19.5,7.6 14.7,12 16.2,18.5 10,15 3.8,18.5 5.3,12 0.5,7.6 7.1,7" fill="currentColor"/></svg>` },
  { id: 'octagon',  label: 'Octagon',  svg: `<svg viewBox="0 0 20 20"><polygon points="7,1 13,1 19,7 19,13 13,19 7,19 1,13 1,7" fill="currentColor"/></svg>` },
];

export class SymbologyPanel {
  constructor() {
    this._currentLayer = null;
    this._state = { selectedRamp: 'sequential_green', classes: [] };

    bus.on(EVENTS.SHOW_SYMBOLOGY, (layer) => this._openLayer(layer));
    bus.on(EVENTS.LAYER_SELECTED, (layer) => {
      if (layer) this._openLayer(layer);
    });
    bus.on(EVENTS.LAYER_REMOVED, () => {
      if (this._currentLayer && !layerManager.layers.find(l => l.id === this._currentLayer.id)) {
        this._currentLayer = null;
        this._renderEmpty();
      }
    });
  }

  _openLayer(layer) {
    this._currentLayer = layer;
    this._state = { selectedRamp: 'sequential_green', classes: layer.style?.classes || [] };
    const body = document.getElementById('rpanel-symbology-body');
    if (!body) return;

    // Open the right panel to symbology if collapsed
    const panel = document.getElementById('right-panel');
    if (panel?.classList.contains('collapsed')) {
      panel.classList.remove('collapsed');
    }
    // Activate symbology tab
    panel?.querySelectorAll('.rpanel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'symbology'));
    panel?.querySelectorAll('.rpanel-content').forEach(c => c.classList.toggle('active', c.dataset.tab === 'symbology'));
    if (panel) panel.dataset.activeTab = 'symbology';

    this._render(body, layer);
  }

  _renderEmpty() {
    const body = document.getElementById('rpanel-symbology-body');
    if (!body) return;
    body.innerHTML = `
      <div class="rpanel-empty">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/></svg>
        <p>Select a layer to edit symbology.</p>
      </div>`;
  }

  _render(body, layer) {
    const s = layer.style || {};
    const gt = layer.geometryType;
    const isVector = layer.type === 'vector' || layer.type === 'esri-feature';
    const fields = isVector ? layerManager.getFields(layer.id) : [];
    const fieldOptions = fields.map(f => `<option value="${f}" ${s.labelField === f ? 'selected' : ''}>${f}</option>`).join('');
    const classFieldOptions = fields.map(f => `<option value="${f}" ${s.classificationField === f ? 'selected' : ''}>${f}</option>`).join('');

    body.innerHTML = `
      <div class="sym-layer-title">
        <span class="sym-layer-name">${layer.name}</span>
        <span class="sym-layer-type">${gt || layer.type}</span>
      </div>

      <div class="tabs sym-tabs">
        <div class="tab active" data-tab="style">Style</div>
        <div class="tab" data-tab="labels">Labels</div>
        <div class="tab" data-tab="classify">Classify</div>
      </div>

      <!-- STYLE TAB -->
      <div id="sym-tab-style" class="tab-content sym-tab-content">
        ${isVector && gt === 'Point' ? `
        <div class="form-group">
          <label class="form-label">Symbol Type</label>
          <div class="sym-symbol-grid">
            ${POINT_SYMBOLS.map(ps => `
              <button class="sym-symbol-btn${(s.pointSymbol || 'circle') === ps.id ? ' active' : ''}" data-sym="${ps.id}" title="${ps.label}" style="color:${s.pointColor || '#60a5fa'}">
                ${ps.svg}
              </button>
            `).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Fill Color</label>
          <div class="color-input-wrap">
            <input type="color" id="sym-point-color" value="${s.pointColor || '#60a5fa'}">
            <input type="text" class="form-input" id="sym-point-color-hex" value="${s.pointColor || '#60a5fa'}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Size <span id="sym-point-radius-val">${s.pointRadius || 6}px</span></label>
          <input type="range" id="sym-point-radius" min="2" max="30" step="1" value="${s.pointRadius || 6}" style="width:100%">
        </div>
        ` : ''}
        ${isVector && gt === 'Polygon' ? `
        <div class="form-group">
          <label class="form-label">Fill Color</label>
          <div class="color-input-wrap">
            <input type="color" id="sym-fill-color" value="${s.fillColor || '#a78bfa'}">
            <input type="text" class="form-input" id="sym-fill-color-hex" value="${s.fillColor || '#a78bfa'}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Fill Opacity <span id="sym-fill-opacity-val">${Math.round((s.fillOpacity ?? 0.35)*100)}%</span></label>
          <input type="range" id="sym-fill-opacity" min="0" max="1" step="0.05" value="${s.fillOpacity ?? 0.35}" style="width:100%">
        </div>
        ` : ''}
        ${isVector && gt === 'LineString' ? `
        <div class="form-group">
          <label class="form-label">Line Color</label>
          <div class="color-input-wrap">
            <input type="color" id="sym-line-color" value="${s.lineColor || '#f97316'}">
            <input type="text" class="form-input" id="sym-line-color-hex" value="${s.lineColor || '#f97316'}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Width <span id="sym-line-width-val">${s.lineWidth || 2}px</span></label>
          <input type="range" id="sym-line-width" min="0.5" max="20" step="0.5" value="${s.lineWidth || 2}" style="width:100%">
        </div>
        <div class="form-group">
          <label class="form-label">Line Style</label>
          <select class="form-select" id="sym-line-dash">
            <option value="solid"    ${!s.lineDashArray ? 'selected' : ''}>Solid</option>
            <option value="dashed"   ${JSON.stringify(s.lineDashArray)==='[4,2]' ? 'selected' : ''}>Dashed</option>
            <option value="dotted"   ${JSON.stringify(s.lineDashArray)==='[1,2]' ? 'selected' : ''}>Dotted</option>
            <option value="dash-dot" ${JSON.stringify(s.lineDashArray)==='[4,2,1,2]' ? 'selected' : ''}>Dash-Dot</option>
          </select>
        </div>
        ` : ''}
        ${isVector ? `
        <div class="form-group">
          <label class="form-label">Stroke Color</label>
          <div class="color-input-wrap">
            <input type="color" id="sym-stroke-color" value="${s.strokeColor || '#ffffff'}">
            <input type="text" class="form-input" id="sym-stroke-color-hex" value="${s.strokeColor || '#ffffff'}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Stroke Width <span id="sym-stroke-width-val">${s.strokeWidth ?? 1.5}px</span></label>
          <input type="range" id="sym-stroke-width" min="0" max="10" step="0.5" value="${s.strokeWidth ?? 1.5}" style="width:100%">
        </div>
        ` : ''}
        <div class="form-group">
          <label class="form-label">Layer Opacity <span id="sym-opacity-val">${Math.round(layer.opacity*100)}%</span></label>
          <input type="range" id="sym-opacity" min="0" max="1" step="0.05" value="${layer.opacity}" style="width:100%">
        </div>
        <div class="sym-actions">
          <button class="btn btn-primary" id="sym-apply">Apply</button>
        </div>
      </div>

      <!-- LABELS TAB -->
      <div id="sym-tab-labels" class="tab-content sym-tab-content" style="display:none">
        <div class="form-group">
          <label class="form-label">Label Field</label>
          <select class="form-select" id="sym-label-field">
            <option value="">— No Labels —</option>
            ${fieldOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Font Size <span id="sym-label-size-val">${s.labelSize || 12}px</span></label>
          <input type="range" id="sym-label-size" min="8" max="32" step="1" value="${s.labelSize || 12}" style="width:100%">
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <div class="color-input-wrap">
            <input type="color" id="sym-label-color" value="${s.labelColor || '#ffffff'}">
            <input type="text" class="form-input" id="sym-label-color-hex" value="${s.labelColor || '#ffffff'}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Halo Color</label>
          <div class="color-input-wrap">
            <input type="color" id="sym-halo-color" value="${s.labelHaloColor || '#0d1a10'}">
            <input type="text" class="form-input" id="sym-halo-color-hex" value="${s.labelHaloColor || '#0d1a10'}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Halo Width <span id="sym-halo-width-val">${s.labelHaloWidth ?? 1}px</span></label>
          <input type="range" id="sym-halo-width" min="0" max="4" step="0.5" value="${s.labelHaloWidth ?? 1}" style="width:100%">
        </div>
        <div class="sym-actions">
          <button class="btn btn-primary" id="sym-labels-apply">Apply Labels</button>
        </div>
      </div>

      <!-- CLASSIFICATION TAB -->
      <div id="sym-tab-classify" class="tab-content sym-tab-content" style="display:none">
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-select" id="sym-class-type">
            <option value="single"     ${s.type === 'single'     ? 'selected' : ''}>Single Symbol</option>
            <option value="graduated"  ${s.type === 'graduated'  ? 'selected' : ''}>Graduated Colors</option>
            <option value="categorized"${s.type === 'categorized'? 'selected' : ''}>Categorized</option>
          </select>
        </div>
        <div id="sym-class-opts" class="${s.type !== 'single' ? '' : 'hidden'}">
          <div class="form-group">
            <label class="form-label">Field</label>
            <select class="form-select" id="sym-class-field">
              <option value="">— Select —</option>
              ${classFieldOptions}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Color Ramp</label>
            <div id="sym-ramp-selector" style="display:grid;grid-template-columns:1fr 1fr;gap:5px">
              ${Object.entries(COLOR_RAMPS).map(([key, colors]) => `
                <div class="ramp-option" data-ramp="${key}" style="cursor:pointer;border:2px solid transparent;border-radius:4px;padding:3px">
                  <div style="display:flex;height:12px;border-radius:2px;overflow:hidden">
                    ${colors.map(c=>`<div style="flex:1;background:${c}"></div>`).join('')}
                  </div>
                  <div style="font-size:9px;color:var(--text-muted);margin-top:2px">${key.replace(/_/g,' ')}</div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Classes</label>
            <input type="number" class="form-input" id="sym-class-count" min="2" max="20" value="${s.classes?.length || 5}" style="width:70px">
          </div>
          <button class="btn btn-secondary w-full" id="sym-classify-btn" style="margin-bottom:8px">Generate Classes</button>
          <div id="sym-class-preview" class="class-list"></div>
        </div>
        <div class="sym-actions">
          <button class="btn btn-primary" id="sym-classify-apply">Apply</button>
        </div>
      </div>
    `;

    this._bindEvents(body, layer);
  }

  _bindEvents(el, layer) {
    const s = { ...layer.style };
    const state = this._state;

    // Tab switching
    el.querySelectorAll('.sym-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        el.querySelectorAll('.sym-tabs .tab').forEach(t => t.classList.remove('active'));
        el.querySelectorAll('.sym-tab-content').forEach(c => c.style.display = 'none');
        tab.classList.add('active');
        el.querySelector(`#sym-tab-${tab.dataset.tab}`).style.display = 'block';
      });
    });

    // Symbol type picker
    el.querySelectorAll('.sym-symbol-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.sym-symbol-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Color sync pairs
    [
      ['sym-point-color','sym-point-color-hex'],
      ['sym-fill-color','sym-fill-color-hex'],
      ['sym-line-color','sym-line-color-hex'],
      ['sym-stroke-color','sym-stroke-color-hex'],
      ['sym-label-color','sym-label-color-hex'],
      ['sym-halo-color','sym-halo-color-hex'],
    ].forEach(([pid, tid]) => {
      const p = el.querySelector(`#${pid}`), t = el.querySelector(`#${tid}`);
      if (!p || !t) return;
      p.addEventListener('input', () => { t.value = p.value; });
      t.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) p.value = t.value; });
    });

    // Range display values
    [
      ['sym-point-radius','sym-point-radius-val', v=>`${v}px`],
      ['sym-fill-opacity','sym-fill-opacity-val', v=>`${Math.round(v*100)}%`],
      ['sym-line-width','sym-line-width-val', v=>`${v}px`],
      ['sym-stroke-width','sym-stroke-width-val', v=>`${v}px`],
      ['sym-opacity','sym-opacity-val', v=>`${Math.round(v*100)}%`],
      ['sym-label-size','sym-label-size-val', v=>`${v}px`],
      ['sym-halo-width','sym-halo-width-val', v=>`${v}px`],
    ].forEach(([rid, vid, fmt]) => {
      const r = el.querySelector(`#${rid}`), v = el.querySelector(`#${vid}`);
      if (!r || !v) return;
      r.addEventListener('input', () => { v.textContent = fmt(parseFloat(r.value)); });
    });

    // Classification type toggle
    const classType = el.querySelector('#sym-class-type');
    const classOpts = el.querySelector('#sym-class-opts');
    if (classType && classOpts) {
      classType.addEventListener('change', () => {
        classOpts.classList.toggle('hidden', classType.value === 'single');
      });
    }

    // Color ramp selection
    el.querySelectorAll('.ramp-option').forEach(opt => {
      opt.addEventListener('click', () => {
        el.querySelectorAll('.ramp-option').forEach(o => o.style.borderColor = 'transparent');
        opt.style.borderColor = 'var(--accent)';
        state.selectedRamp = opt.dataset.ramp;
      });
    });

    // Generate classes
    el.querySelector('#sym-classify-btn')?.addEventListener('click', () => {
      const field = el.querySelector('#sym-class-field')?.value;
      const count = parseInt(el.querySelector('#sym-class-count')?.value || 5);
      const type  = classType?.value;
      if (!field) return;
      state.classes = this._generateClasses(layer, field, count, type, state.selectedRamp);
      this._renderClassPreview(el, state.classes);
    });

    // Apply style
    el.querySelector('#sym-apply')?.addEventListener('click', () => {
      const newStyle = this._collectStyle(el, layer, state);
      layerManager.updateStyle(layer.id, newStyle);
      layerManager.updateLayer(layer.id, { opacity: parseFloat(el.querySelector('#sym-opacity')?.value || 1) });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Style applied' });
    });

    // Apply labels
    el.querySelector('#sym-labels-apply')?.addEventListener('click', () => {
      const labelField = el.querySelector('#sym-label-field')?.value || null;
      const labelSize  = parseFloat(el.querySelector('#sym-label-size')?.value || 12);
      const labelColor = el.querySelector('#sym-label-color')?.value || '#ffffff';
      const labelHaloColor = el.querySelector('#sym-halo-color')?.value || '#0d1a10';
      const labelHaloWidth = parseFloat(el.querySelector('#sym-halo-width')?.value || 1);
      layerManager.updateStyle(layer.id, { labelField, labelSize, labelColor, labelHaloColor, labelHaloWidth });
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: labelField ? 'Labels applied' : 'Labels removed' });
    });

    // Apply classification
    el.querySelector('#sym-classify-apply')?.addEventListener('click', () => {
      const type = el.querySelector('#sym-class-type')?.value || 'single';
      const field = el.querySelector('#sym-class-field')?.value;
      const newStyle = this._collectStyle(el, layer, state);
      newStyle.type = type;
      if (type !== 'single') { newStyle.classificationField = field; newStyle.classes = state.classes; }
      layerManager.updateStyle(layer.id, newStyle);
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Classification applied' });
    });
  }

  _collectStyle(el, layer, state) {
    const g  = (id) => el.querySelector(`#${id}`)?.value;
    const gf = (id) => parseFloat(g(id) || 0);
    const gt = layer.geometryType;

    const style = {
      strokeColor: g('sym-stroke-color') || '#ffffff',
      strokeWidth: gf('sym-stroke-width') || 1.5,
      strokeOpacity: 1,
    };

    if (gt === 'Polygon') {
      style.fillColor   = g('sym-fill-color') || '#a78bfa';
      style.fillOpacity = gf('sym-fill-opacity') || 0.35;
    } else if (gt === 'LineString') {
      style.lineColor  = g('sym-line-color') || '#f97316';
      style.lineWidth  = gf('sym-line-width') || 2;
      style.lineOpacity = 0.9;
      const dash = g('sym-line-dash');
      style.lineDashArray = dash === 'dashed' ? [4,2] : dash === 'dotted' ? [1,2] : dash === 'dash-dot' ? [4,2,1,2] : null;
    } else {
      style.pointColor  = g('sym-point-color') || '#60a5fa';
      style.pointRadius = gf('sym-point-radius') || 6;
      style.pointOpacity = 0.85;
      const symBtn = el.querySelector('.sym-symbol-btn.active');
      style.pointSymbol = symBtn?.dataset.sym || 'circle';
    }

    return style;
  }

  _generateClasses(layer, field, count, type, rampKey) {
    const ramp = COLOR_RAMPS[rampKey] || COLOR_RAMPS.sequential_green;
    const values = (layer.data?.features || []).map(f => f.properties?.[field]).filter(v => v != null && v !== '');

    if (type === 'categorized') {
      const unique = [...new Set(values)].slice(0, count);
      return unique.map((val, i) => ({ value: val, label: String(val), color: ramp[i % ramp.length] }));
    }

    const nums = values.map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    if (!nums.length) return [];
    const min = nums[0], max = nums[nums.length - 1];
    const step = (max - min) / count;
    const colors = interpolateColors(ramp, count);
    return Array.from({ length: count }, (_, i) => ({
      min: min + i * step,
      max: min + (i + 1) * step,
      label: `${(min + i * step).toFixed(2)} – ${(min + (i + 1) * step).toFixed(2)}`,
      color: colors[i],
    }));
  }

  _renderClassPreview(el, classes) {
    const preview = el.querySelector('#sym-class-preview');
    if (!preview) return;
    preview.innerHTML = classes.map(cls => `
      <div class="class-row">
        <div class="class-swatch" style="background:${cls.color}"></div>
        <span class="class-label">${cls.label || cls.value || ''}</span>
      </div>
    `).join('');
  }
}

function interpolateColors(ramp, count) {
  if (count <= ramp.length) return ramp.slice(0, count);
  const result = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const idx = t * (ramp.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.min(Math.ceil(idx), ramp.length - 1);
    result.push(lerpColor(ramp[lower], ramp[upper], idx - lower));
  }
  return result;
}

function lerpColor(a, b, t) {
  const ah = a.replace('#',''), bh = b.replace('#','');
  const r = Math.round(parseInt(ah.slice(0,2),16) + (parseInt(bh.slice(0,2),16)-parseInt(ah.slice(0,2),16))*t);
  const g = Math.round(parseInt(ah.slice(2,4),16) + (parseInt(bh.slice(2,4),16)-parseInt(ah.slice(2,4),16))*t);
  const bv= Math.round(parseInt(ah.slice(4,6),16) + (parseInt(bh.slice(4,6),16)-parseInt(ah.slice(4,6),16))*t);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bv.toString(16).padStart(2,'0')}`;
}
