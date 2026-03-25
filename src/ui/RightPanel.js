import { bus, EVENTS } from '../utils/EventBus.js';

/**
 * RightPanel — docked tabbed panel on the right side.
 * Hosts "Catalog" and "Symbology" tabs.
 * Collapsible via toggle button.
 */
export class RightPanel {
  constructor(catalogRenderer, symbologyPanel) {
    this._catalogRenderer = catalogRenderer;  // DataCatalog instance
    this._symbologyPanel = symbologyPanel;    // SymbologyPanel instance
    this._activeTab = 'catalog';
    this._collapsed = false;
    this._currentLayer = null;
    this._panel = null;
    this._catalogBody = null;
    this._symbologyBody = null;

    // Register globally so SymbologyPanel can find us
    window._rightPanel = this;

    this._build();
    this._bindEvents();
  }

  _build() {
    this._panel = document.getElementById('right-panel');
    if (!this._panel) return;

    this._panel.innerHTML = `
      <div class="rp-header">
        <div class="rp-tabs">
          <button class="rp-tab active" data-tab="catalog">
            <svg viewBox="0 0 24 24"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M3 14h7v7H3z"/><path d="M14 14h7v7h-7z"/></svg>
            Catalog
          </button>
          <button class="rp-tab" data-tab="symbology">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg>
            Symbology
          </button>
        </div>
        <button class="rp-collapse-btn" id="rp-collapse-btn" title="Collapse panel">
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="rp-content">
        <div id="rp-catalog-pane" class="rp-pane active"></div>
        <div id="rp-symbology-pane" class="rp-pane" style="display:none">
          <div class="rp-sym-empty" id="rp-sym-empty">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/></svg>
            <p>Select a layer in the TOC<br>then click the style button.</p>
          </div>
          <div id="rp-sym-content" style="display:none;overflow-y:auto;height:100%"></div>
        </div>
      </div>
    `;

    this._catalogBody = this._panel.querySelector('#rp-catalog-pane');
    this._symbologyBody = this._panel.querySelector('#rp-sym-content');

    // Render catalog immediately
    if (this._catalogRenderer) {
      this._catalogRenderer.renderInto(this._catalogBody);
    }
  }

  _bindEvents() {
    if (!this._panel) return;

    // Tab clicks
    this._panel.querySelectorAll('.rp-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Collapse toggle
    this._panel.querySelector('#rp-collapse-btn')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // Re-render catalog on layer changes
    bus.on(EVENTS.LAYER_ADDED, () => this._refreshCatalog());
    bus.on(EVENTS.LAYER_REMOVED, () => this._refreshCatalog());
    bus.on(EVENTS.LAYER_UPDATED, () => this._refreshCatalog());
  }

  switchTab(tabName) {
    this._activeTab = tabName;
    this._panel?.querySelectorAll('.rp-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tabName);
    });
    this._panel?.querySelectorAll('.rp-pane').forEach(p => {
      p.style.display = 'none';
    });
    const target = this._panel?.querySelector(`#rp-${tabName}-pane`);
    if (target) target.style.display = 'flex';

    if (tabName === 'catalog') this._refreshCatalog();
  }

  showSymbology(layer) {
    this._currentLayer = layer;
    this.switchTab('symbology');
    this._expand();

    const empty = this._panel?.querySelector('#rp-sym-empty');
    const content = this._symbologyBody;
    if (!empty || !content) return;

    empty.style.display = 'none';
    content.style.display = 'block';

    // Render symbology controls into the panel
    this._symbologyPanel.renderInto(content, layer);
  }

  toggleCollapse() {
    this._collapsed ? this._expand() : this._collapse();
  }

  _collapse() {
    this._collapsed = true;
    this._panel?.classList.add('collapsed');
    const btn = this._panel?.querySelector('#rp-collapse-btn svg');
    if (btn) btn.style.transform = 'rotate(180deg)';
    // Notify map to resize
    window.dispatchEvent(new Event('resize'));
  }

  _expand() {
    this._collapsed = false;
    this._panel?.classList.remove('collapsed');
    const btn = this._panel?.querySelector('#rp-collapse-btn svg');
    if (btn) btn.style.transform = '';
    window.dispatchEvent(new Event('resize'));
  }

  _refreshCatalog() {
    if (this._activeTab === 'catalog' && this._catalogBody && this._catalogRenderer) {
      this._catalogRenderer.renderInto(this._catalogBody);
    }
  }
}
