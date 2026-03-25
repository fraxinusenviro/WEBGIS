import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager, POINT_SHAPES } from '../layers/LayerManager.js';
import { openModal, closeModal } from './Modal.js';

const COLOR_RAMPS = {
  sequential_green: ['#f7fcf5','#c7e9c0','#74c476','#238b45','#00441b'],
  sequential_blue:  ['#f7fbff','#c6dbef','#6baed6','#2171b5','#084594'],
  sequential_red:   ['#fff5f0','#fcbba1','#fb6a4a','#cb181d','#67000d'],
  diverging_rygb:   ['#d73027','#fc8d59','#fee090','#91bfdb','#4575b4'],
  qualitative:      ['#e41a1c','#377eb8','#4daf4a','#984ea3','#ff7f00','#ffff33','#a65628','#f781bf'],
};

/** SVG preview paths for point shape selector */
const SHAPE_SVGS = {
  circle:   `<circle cx="12" cy="12" r="7"/>`,
  square:   `<rect x="5" y="5" width="14" height="14"/>`,
  triangle: `<polygon points="12,4 21,20 3,20"/>`,
  diamond:  `<polygon points="12,3 21,12 12,21 3,12"/>`,
  cross:    `<path d="M12 4v16M4 12h16" stroke-width="3.5"/>`,
  x:        `<path d="M5 5l14 14M19 5L5 19" stroke-width="3.5"/>`,
  octagon:  `<polygon points="8,4 16,4 20,8 20,16 16,20 8,20 4,16 4,8"/>`,
  star:     `<polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9"/>`,
  pentagon: `<polygon points="12,3 21,9 17,20 7,20 3,9"/>`,
};

export class SymbologyPanel {
  constructor() {
    this._dockedLayer = null;  // layer shown in the docked panel
    bus.on(EVENTS.SHOW_SYMBOLOGY, (layer) => this._handleShowSymbology(layer));
  }

  /** Called when SHOW_SYMBOLOGY event fires — open in RightPanel if available, else modal */
  _handleShowSymbology(layer) {
    // Prefer docked right panel
    const rightPanel = window._rightPanel;
    if (rightPanel) {
      rightPanel.showSymbology(layer);
    } else {
      this.openModal(layer);
    }
  }

  /** Open as a floating modal (fallback) */
  openModal(layer) {
    const content = document.createElement('div');
    content.innerHTML = this._buildContent(layer);

    const modal = openModal({
      title: `Symbology — ${layer.name}`,
      content,
      width: 460,
    });

    this._bindEvents(modal, layer, () => closeModal());
  }

  /**
   * Render symbology controls into a given container element.
   * Used by RightPanel to render into the docked pane.
   * @param {HTMLElement} container
   * @param {Object} layer
   */
  renderInto(container, layer) {
    container.innerHTML = this._buildContent(layer);
    this._bindEvents(container, layer, null);
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
    const isRaster = !isVector;

    if (isRaster) {
      return `
        <div class="sym-section">
          <div class="form-group">
            <label class="form-label">Layer Opacity</label>
            <div style="display:flex;align-items:center;gap:10px">
              <input type="range" id="sym-opacity" min="0" max="1" step="0.05" value="${layer.opacity}" style="flex:1">
              <span id="sym-opacity-val">${Math.round(layer.opacity * 100)}%</span>
            </div>
          </div>
        </div>
        <div class="sym-footer">
          <button class="btn btn-primary" id="sym-apply">Apply</button>
        </div>`;
    }

    const fields = layerManager.getFields(layer.id);
    const fieldOptions = fields.map(f => `<option value="${f}" ${s.classificationField === f ? 'selected' : ''}>${f}</option>`).join('');
    const labelFieldOptions = fields.map(f => `<option value="${f}" ${s.labelField === f ? 'selected' : ''}>${f}</option>`).join('');

    return `
      <div class="tabs sym-tabs">
        <div class="tab active" data-tab="style">Style</div>
        <div class="tab" data-tab="labels">Labels</div>
        <div class="tab" data-tab="classify">Classify</div>
      </div>

      <!-- STYLE TAB -->
      <div id="tab-style" class="tab-content sym-section">
        ${gt === 'Point' ? `
        <div class="form-group">
          <label class="form-label">Symbol Shape</label>
          <div class="symbol-shape-grid" id="sym-shape-grid">
            ${POINT_SHAPES.map(sh => `
              <button class="symbol-shape-btn${(s.pointShape || 'circle') === sh ? ' active' : ''}"
                      data-shape="${sh}" title="${sh}">
                <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5">
                  ${SHAPE_SVGS[sh] || SHAPE_SVGS.circle}
                </svg>
                <span>${sh}</span>
              </button>
            `).join('')}
          </div>
        </div>
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
        ${gt === 'Polygon' ? `
        <div class="form-group">
          <label class="form-label">Fill Color</label>
          <div class="color-input-wrap">
            <input type="color" id="sym-fill-color" value="${s.fillColor || '#a78bfa'}">
            <input type="text" class="form-input" id="sym-fill-color-hex" value="${s.fillColor || '#a78bfa'}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Fill Opacity</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="sym-fill-opacity" min="0" max="1" step="0.05" value="${s.fillOpacity ?? 0.35}" style="flex:1">
            <span id="sym-fill-opacity-val">${Math.round((s.fillOpacity ?? 0.35) * 100)}%</span>
          </div>
        </div>
        ` : ''}
        ${gt === 'LineString' ? `
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
        ${gt !== 'LineString' ? `
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
      <div id="tab-labels" class="tab-content sym-section" style="display:none">
        <div class="form-group">
          <label class="form-label">Label Field</label>
          <select class="form-select" id="sym-label-field">
            <option value="">— No Labels —</option>
            ${labelFieldOptions}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Label Size</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input type="range" id="sym-label-size" min="8" max="32" step="1" value="${s.labelSize || 12}" style="flex:1">
            <span id="sym-label-size-val">${s.labelSize || 12}px</span>
          </div>
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
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Tip: Click Apply to see labels on the map.
        </p>
      </div>

      <!-- CLASSIFICATION TAB -->
      <div id="tab-classification" class="tab-content sym-section" style="display:none">
        <div class="form-group">
          <label class="form-label">Type</label>
          <select class="form-select" id="sym-class-type">
            <option value="single" ${(s.type || 'single') === 'single' ? 'selected' : ''}>Single Symbol</option>
            <option value="graduated" ${s.type === 'graduated' ? 'selected' : ''}>Graduated Colors</option>
            <option value="categorized" ${s.type === 'categorized' ? 'selected' : ''}>Categorized</option>
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

      <div class="sym-footer">
        <button class="btn btn-ghost" id="sym-cancel">Cancel</button>
        <button class="btn btn-primary" id="sym-apply">Apply</button>
      </div>
    `;

    this._bindEvents(body, layer);
  }

  _bindEvents(container, layer, onClose) {
    const s = { ...layer.style };
    const state = {
      selectedRamp: 'sequential_green',
      classes: s.classes || [],
      selectedShape: s.pointShape || 'circle',
    };

    // Tab switching
    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
        tab.classList.add('active');
        container.querySelector(`#tab-${tab.dataset.tab}`)?.style && (
          container.querySelector(`#tab-${tab.dataset.tab}`).style.display = 'block'
        );
      });
    });

    // Shape selector
    container.querySelectorAll('.symbol-shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.symbol-shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.selectedShape = btn.dataset.shape;
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
      ['sym-fill-color', 'sym-fill-color-hex'],
      ['sym-point-color', 'sym-point-color-hex'],
      ['sym-line-color', 'sym-line-color-hex'],
      ['sym-stroke-color', 'sym-stroke-color-hex'],
      ['sym-label-color', 'sym-label-color-hex'],
      ['sym-halo-color', 'sym-halo-color-hex'],
    ].forEach(([picker, text]) => {
      const p = container.querySelector(`#${picker}`);
      const t = container.querySelector(`#${text}`);
      if (!p || !t) return;
      p.addEventListener('input', () => { t.value = p.value; });
      t.addEventListener('input', () => { if (/^#[0-9a-f]{6}$/i.test(t.value)) p.value = t.value; });
    });

    // Range display values
    [
      ['sym-fill-opacity', 'sym-fill-opacity-val', v => `${Math.round(v * 100)}%`],
      ['sym-point-radius', 'sym-point-radius-val', v => `${v}px`],
      ['sym-line-width', 'sym-line-width-val', v => `${v}px`],
      ['sym-stroke-width', 'sym-stroke-width-val', v => `${v}px`],
      ['sym-opacity', 'sym-opacity-val', v => `${Math.round(v * 100)}%`],
      ['sym-label-size', 'sym-label-size-val', v => `${v}px`],
    ].forEach(([rangeId, valId, fmt]) => {
      const range = container.querySelector(`#${rangeId}`);
      const valEl = container.querySelector(`#${valId}`);
      if (!range || !valEl) return;
      range.addEventListener('input', () => { valEl.textContent = fmt(parseFloat(range.value)); });
    });

    // Classification type change
    const classType = container.querySelector('#sym-class-type');
    const classOpts = container.querySelector('#sym-class-opts');
    if (classType && classOpts) {
      classType.addEventListener('change', () => {
        classOpts.classList.toggle('hidden', classType.value === 'single');
      });
    }

    // Color ramp selection
    container.querySelectorAll('.ramp-option').forEach(opt => {
      opt.addEventListener('click', () => {
        container.querySelectorAll('.ramp-option').forEach(o => o.style.borderColor = 'transparent');
        opt.style.borderColor = 'var(--accent)';
        state.selectedRamp = opt.dataset.ramp;
      });
    });

    // Generate classes
    const classifyBtn = container.querySelector('#sym-classify-btn');
    if (classifyBtn) {
      classifyBtn.addEventListener('click', () => {
        const field = container.querySelector('#sym-class-field')?.value;
        const count = parseInt(container.querySelector('#sym-class-count')?.value || 5);
        const type = classType?.value;
        if (!field) return;
        state.classes = this._generateClasses(layer, field, count, type, state.selectedRamp);
        this._renderClassPreview(container, state.classes);
      });
    }

    // Apply
    container.querySelector('#sym-apply')?.addEventListener('click', () => {
      const newStyle = this._collectStyle(container, layer, state);
      layerManager.updateStyle(layer.id, newStyle);
      const opacityEl = container.querySelector('#sym-opacity');
      if (opacityEl) {
        layerManager.updateLayer(layer.id, { opacity: parseFloat(opacityEl.value) });
      }
      if (onClose) onClose();
      else bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Symbology applied' });
    });

    // Cancel
    container.querySelector('#sym-cancel')?.addEventListener('click', () => {
      if (onClose) onClose();
    });
  }

  _collectStyle(container, layer, state) {
    const g = (id) => container.querySelector(`#${id}`)?.value;
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
      style.pointShape = state.selectedShape || 'circle';
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
    const interpolatedColors = interpolateColors(ramp, count);

    return Array.from({ length: count }, (_, i) => ({
      min: min + i * step,
      max: min + (i + 1) * step,
      label: `${(min + i * step).toFixed(2)} – ${(min + (i + 1) * step).toFixed(2)}`,
      color: colors[i],
    }));
  }

  _renderClassPreview(container, classes) {
    const preview = container.querySelector('#sym-class-preview');
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
