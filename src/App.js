import { bus, EVENTS } from './utils/EventBus.js';
import { openModal, closeModal } from './ui/Modal.js';
import { mapManager } from './map/MapManager.js';
import { basemapLayerManager } from './map/BasemapLayerManager.js';
import { layerManager } from './layers/LayerManager.js';
import { importManager } from './io/ImportManager.js';
import { exportManager } from './io/ExportManager.js';
import { serviceConnector } from './io/ServiceConnector.js';
import { editingManager } from './editing/EditingManager.js';
import { projectManager } from './project/ProjectManager.js';
import { packageManager } from './project/PackageManager.js';
import { storage } from './storage/StorageManager.js';
import { initToast } from './ui/Toast.js';
import { TOCPanel } from './ui/TOCPanel.js';
import { SymbologyPanel } from './ui/SymbologyPanel.js';
import { GeoprocessingPanel } from './ui/GeoprocessingPanel.js';
import { ServiceDialog } from './ui/ServiceDialog.js';
import { AttributeTable } from './ui/AttributeTable.js';
import { IdentifyPanel } from './ui/IdentifyPanel.js';
import { dataCatalog } from './ui/DataCatalog.js';
import { zoomToScale } from './utils/coordinates.js';
import { feltManager } from './io/FeltManager.js';

/**
 * App — main orchestrator
 * Wires together all managers, sets up UI event handlers
 */
export class App {
  constructor() {
    this._activeTool = 'select';
    this._tocPanel = null;
    this._symbologyPanel = null;
    this._gpPanel = null;
    this._serviceDialog = null;
    this._attrTable = null;
    this._identifyPanel = null;
    this._dataCatalog = null;
  }

  async init() {
    // Initialize toast first so errors can show
    initToast();

    // Init map
    mapManager.init('map', { center: [-63.2, 45.0], zoom: 7 });

    // Wait for map ready then wire everything up
    bus.on(EVENTS.MAP_READY, () => this._onMapReady());

    // Init UI panels
    this._tocPanel = new TOCPanel();
    this._symbologyPanel = new SymbologyPanel();
    this._gpPanel = new GeoprocessingPanel();
    this._serviceDialog = new ServiceDialog();
    this._attrTable = new AttributeTable();
    this._identifyPanel = new IdentifyPanel();
    this._dataCatalog = dataCatalog;

    // Wire toolbar buttons
    this._bindToolbar();

    // Wire map tool buttons
    this._bindMapTools();

    // Wire map controls
    this._bindMapControls();

    // Wire file inputs
    this._bindFileInputs();

    // Wire drag-and-drop
    this._bindDragDrop();

    // Wire panel resize handles
    this._bindResizeHandle();
    this._bindRightPanelResize();
    this._bindTocInternalResize();
    this._bindRightPanelTabs();

    // Wire TOC add layer button
    document.getElementById('btn-toc-add-layer')?.addEventListener('click', () => {
      document.getElementById('file-input-data')?.click();
    });

    // Wire TOC collapse
    document.getElementById('btn-toc-collapse')?.addEventListener('click', () => {
      document.querySelectorAll('.layer-expand.open').forEach(el => el.classList.remove('open'));
    });

    // Wire zoom all
    document.getElementById('btn-zoom-all')?.addEventListener('click', () => {
      const layers = layerManager.layers;
      if (!layers.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const l of layers) {
        if (!l.bbox) continue;
        const [[lx, ly], [hx, hy]] = l.bbox;
        minX = Math.min(minX, lx); minY = Math.min(minY, ly);
        maxX = Math.max(maxX, hx); maxY = Math.max(maxY, hy);
      }
      if (isFinite(minX)) mapManager.zoomToExtent([[minX, minY], [maxX, maxY]]);
    });

    // Keyboard shortcuts
    this._bindKeyboard();

    // Start auto-save
    projectManager.startAutoSave(60000);
  }

  _onMapReady() {
    // Show initial coordinates
    const map = mapManager.map;
    const center = map.getCenter();
    const z = map.getZoom();
    document.getElementById('zoom-display').textContent = `Zoom: ${z.toFixed(2)}`;
    document.getElementById('scale-display').textContent = `1:${zoomToScale(z, center.lat).toLocaleString()}`;

    // Try restore last session
    projectManager.tryRestoreSession();

    // Set default tool
    this._setActiveTool('select');

    // Add default basemap stack (bottom → top render order, top → bottom TOC order)
    // Only if no project was restored (session restore handles its own basemaps)
    if (!basemapLayerManager.stack.length) {
      basemapLayerManager.addBasemap('hrdem-dtm-hillshade', { opacity: 1.0, visible: false });
      basemapLayerManager.addBasemap('hrdem-dsm-hillshade', { opacity: 1.0, visible: false });
      basemapLayerManager.addBasemap('satellite', { opacity: 1.0, visible: false });
      basemapLayerManager.addBasemap('esri-imagery-hybrid', { opacity: 1.0, visible: true });
      basemapLayerManager.addBasemap('hrdem-dtm-hillshade', { opacity: 0.4, visible: true });
      basemapLayerManager.addBasemap('osm', { opacity: 1.0, visible: false });
    }
  }

  // ---- Toolbar ----
  _bindToolbar() {
    document.getElementById('btn-new-project')?.addEventListener('click', () => {
      projectManager.newProject();
    });

    document.getElementById('btn-open-project')?.addEventListener('click', () => {
      document.getElementById('file-input-project')?.click();
    });

    document.getElementById('btn-save-project')?.addEventListener('click', () => {
      // If shift held, save to file instead
      projectManager.saveToFile();
    });

    document.getElementById('btn-export-package')?.addEventListener('click', () => {
      const name = prompt('Package name:', projectManager.currentProject.name);
      if (name !== null) packageManager.exportPackage(name);
    });

    document.getElementById('btn-add-file')?.addEventListener('click', () => {
      document.getElementById('file-input-data')?.click();
    });

    document.getElementById('btn-add-service')?.addEventListener('click', () => {
      bus.emit(EVENTS.SHOW_SERVICE_DIALOG);
    });

    document.getElementById('btn-geoprocessing')?.addEventListener('click', () => {
      bus.emit(EVENTS.SHOW_GP_PANEL);
    });

    document.getElementById('btn-data-catalog')?.addEventListener('click', () => {
      this._showRightPanel('catalog');
    });

    document.getElementById('btn-felt-upload')?.addEventListener('click', () => {
      this._showFeltUploadDialog();
    });

    document.getElementById('btn-attribute-table')?.addEventListener('click', () => {
      // Open for first vector layer or prompt selection
      const layers = layerManager.layers.filter(l => l.type === 'vector' || l.type === 'esri-feature');
      if (layers.length === 1) {
        bus.emit(EVENTS.SHOW_ATTR_TABLE, layers[0]);
      } else if (layers.length > 1) {
        this._showLayerPickerForTable(layers);
      } else {
        bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'No vector layers to show' });
      }
    });

    document.getElementById('btn-add-basemap')?.addEventListener('click', () => {
      this._tocPanel.showBasemapPicker();
    });

    // Settings button — for now shows storage info
    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this._showSettings();
    });
  }

  _showLayerPickerForTable(layers) {
    const content = document.createElement('div');
    content.innerHTML = `
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">Select a layer to view:</p>
      ${layers.map(l => `
        <button class="btn btn-secondary w-full" data-id="${l.id}" style="margin-bottom:6px;justify-content:flex-start">
          ${l.name} (${l.data?.features?.length || 0} features)
        </button>
      `).join('')}
    `;
    openModal({ title: 'Select Layer', content, width: 360 });
    content.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = layerManager.layers.find(l => l.id === btn.dataset.id);
        closeModal();
        if (layer) bus.emit(EVENTS.SHOW_ATTR_TABLE, layer);
      });
    });
  }

  async _showSettings() {
    const usage = await storage.estimateUsage();
    const feltKey = localStorage.getItem('felt_api_key') || '';
    const feltMapId = localStorage.getItem('felt_map_id') || '';
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="section-title">Storage</div>
      ${usage ? `
        <div style="margin-bottom:12px">
          <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100,(usage.used/usage.quota)*100).toFixed(1)}%"></div></div>
          <p style="font-size:11px;color:var(--text-muted)">${usage.usedMB} MB used of ${usage.quotaMB} MB quota</p>
        </div>
      ` : '<p style="font-size:12px;color:var(--text-muted)">Storage estimate unavailable</p>'}
      <div class="section-title">Project</div>
      <div class="form-group">
        <label class="form-label">Project Name</label>
        <input type="text" class="form-input" id="settings-proj-name" value="${projectManager.currentProject.name}">
      </div>
      <div class="section-title" style="margin-top:14px">Felt Integration</div>
      <div class="form-group">
        <label class="form-label">Felt API Key</label>
        <input type="password" class="form-input" id="settings-felt-key" placeholder="felt_pub_..." value="${feltKey}" autocomplete="off">
      </div>
      <div class="form-group">
        <label class="form-label">Default Felt Map ID</label>
        <input type="text" class="form-input" id="settings-felt-map" placeholder="Map ID from Felt URL" value="${feltMapId}">
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="settings-save-felt">Save Felt Settings</button>
        <button class="btn btn-danger" id="settings-clear-storage">Clear All Stored Data</button>
      </div>
    `;
    openModal({ title: 'Settings', content, width: 400 });

    content.querySelector('#settings-proj-name')?.addEventListener('change', (e) => {
      projectManager.setName(e.target.value);
    });

    content.querySelector('#settings-save-felt')?.addEventListener('click', () => {
      const key = content.querySelector('#settings-felt-key')?.value?.trim();
      const mapId = content.querySelector('#settings-felt-map')?.value?.trim();
      if (key) localStorage.setItem('felt_api_key', key);
      if (mapId) localStorage.setItem('felt_map_id', mapId);
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Felt settings saved' });
      closeModal();
    });

    content.querySelector('#settings-clear-storage')?.addEventListener('click', async () => {
      if (confirm('This will delete all saved projects and layer data. Continue?')) {
        await storage.clearAllLayerData();
        bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Storage cleared' });
      }
    });
  }

  _showFeltUploadDialog() {
    const vectorLayers = layerManager.layers.filter(l => l.type === 'vector' || l.type === 'esri-feature');
    if (!vectorLayers.length) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'No vector layers to upload' });
      return;
    }
    const apiKey = localStorage.getItem('felt_api_key') || '';
    const savedMapId = localStorage.getItem('felt_map_id') || '';
    const content = document.createElement('div');
    content.innerHTML = `
      <div class="form-group">
        <label class="form-label">Layer to Upload</label>
        <select class="form-select" id="felt-layer-pick">
          ${vectorLayers.map(l => `<option value="${l.id}">${l.name} (${l.data?.features?.length || 0} features)</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Felt Map ID</label>
        <input type="text" class="form-input" id="felt-map-id" value="${savedMapId}" placeholder="From Felt map URL">
      </div>
      ${!apiKey ? `<p style="font-size:11px;color:var(--warning);margin-bottom:8px">⚠ No Felt API key set — configure in Settings first.</p>` : ''}
      <div class="form-group" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="felt-export-style" checked>
        <label style="font-size:12px;cursor:pointer" for="felt-export-style">Export symbology as Felt Style Language (FSL)</label>
      </div>
    `;
    const footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn-ghost" id="felt-cancel">Cancel</button>
      <button class="btn btn-primary" id="felt-upload-btn" ${!apiKey ? 'disabled title="Set Felt API key in Settings"' : ''}>
        <svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;margin-right:4px"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
        Upload to Felt
      </button>
    `;
    openModal({ title: 'Upload to Felt', content, footer, width: 420 });

    footer.querySelector('#felt-cancel')?.addEventListener('click', closeModal);
    footer.querySelector('#felt-upload-btn')?.addEventListener('click', async () => {
      const layerId = content.querySelector('#felt-layer-pick')?.value;
      const mapId = content.querySelector('#felt-map-id')?.value?.trim();
      const withStyle = content.querySelector('#felt-export-style')?.checked;
      if (!mapId) {
        bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: 'Enter a Felt Map ID' });
        return;
      }
      const layer = layerManager.layers.find(l => l.id === layerId);
      if (!layer) return;
      closeModal();
      bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: `Uploading "${layer.name}" to Felt…` });
      const result = await feltManager.uploadLayer(layer, mapId, withStyle);
      if (result.ok) {
        bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Uploaded to Felt: ${layer.name}` });
      } else {
        bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Felt upload failed: ${result.error}` });
      }
    });
  }

  // ---- Right panel ----
  _showRightPanel(tab) {
    const panel = document.getElementById('right-panel');
    if (!panel) return;
    const isOpen = !panel.classList.contains('collapsed');
    const currentTab = panel.dataset.activeTab;
    if (isOpen && currentTab === tab) {
      panel.classList.add('collapsed');
    } else {
      panel.classList.remove('collapsed');
      this._activateRightTab(tab);
    }
  }

  _activateRightTab(tab) {
    const panel = document.getElementById('right-panel');
    if (!panel) return;
    panel.dataset.activeTab = tab;
    panel.querySelectorAll('.rpanel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    panel.querySelectorAll('.rpanel-content').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
    // Refresh catalog if switching to it
    if (tab === 'catalog') dataCatalog.renderInto(document.getElementById('rpanel-catalog-body'));
  }

  _bindRightPanelTabs() {
    document.querySelectorAll('.rpanel-tab').forEach(btn => {
      btn.addEventListener('click', () => this._activateRightTab(btn.dataset.tab));
    });
    document.getElementById('btn-collapse-right')?.addEventListener('click', () => {
      document.getElementById('right-panel')?.classList.toggle('collapsed');
    });
    // Listen for symbology events to open right panel
    bus.on(EVENTS.SHOW_SYMBOLOGY, (layer) => {
      this._showRightPanel('symbology');
    });
    // Listen for layer selection to open symbology
    bus.on(EVENTS.LAYER_SELECTED, (layer) => {
      if (layer) {
        const panel = document.getElementById('right-panel');
        if (panel && !panel.classList.contains('collapsed') && panel.dataset.activeTab === 'symbology') {
          // already open, symbology panel will update itself
        }
      }
    });
  }

  // ---- Right panel resize handle ----
  _bindRightPanelResize() {
    const handle = document.getElementById('right-resize-handle');
    const panel = document.getElementById('right-panel');
    if (!handle || !panel) return;
    let dragging = false, startX, startW;
    handle.addEventListener('mousedown', (e) => {
      dragging = true; startX = e.clientX; startW = panel.offsetWidth;
      handle.classList.add('active');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newW = Math.max(220, Math.min(600, startW - (e.clientX - startX)));
      panel.style.width = `${newW}px`;
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; handle.classList.remove('active');
      document.body.style.userSelect = ''; document.body.style.cursor = '';
    });
  }

  // ---- TOC internal vertical resize (layers / basemaps split) ----
  _bindTocInternalResize() {
    const handle = document.getElementById('toc-vsplit-handle');
    const layerList = document.getElementById('layer-list');
    const bmSection = document.getElementById('basemap-section');
    if (!handle || !layerList || !bmSection) return;

    let dragging = false, startY, startLayerH;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startLayerH = layerList.offsetHeight;
      handle.classList.add('active');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const tocH = document.getElementById('toc-panel').offsetHeight
        - document.querySelector('#toc-panel .panel-header').offsetHeight
        - document.querySelector('#toc-panel .panel-footer')?.offsetHeight
        - (document.querySelector('.toc-section-header')?.offsetHeight || 0)
        - handle.offsetHeight - 48;
      const newH = Math.max(60, Math.min(tocH, startLayerH + e.clientY - startY));
      layerList.style.flex = 'none';
      layerList.style.height = `${newH}px`;
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; handle.classList.remove('active');
      document.body.style.userSelect = ''; document.body.style.cursor = '';
    });
  }

  // ---- Map tool buttons ----
  _bindMapTools() {
    document.querySelectorAll('.map-tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        this._setActiveTool(tool);
      });
    });
  }

  _setActiveTool(tool) {
    this._activeTool = tool;

    // Update button states
    document.querySelectorAll('.map-tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    // Disable identify mode
    editingManager.disableIdentify();

    // Set cursor
    const mapCanvas = document.querySelector('#map canvas');
    if (mapCanvas) mapCanvas.style.cursor = '';

    switch(tool) {
      case 'select':
        editingManager.setMode('simple_select');
        break;
      case 'draw_point':
      case 'draw_line_string':
      case 'draw_polygon':
        editingManager.setMode(tool);
        break;
      case 'direct_select':
        editingManager.setMode('direct_select');
        break;
      case 'delete':
        editingManager.deleteSelected();
        this._setActiveTool('select');
        return;
      case 'measure':
        editingManager.setMode('simple_select');
        editingManager.startMeasure();
        break;
      case 'identify':
        editingManager.setMode('simple_select');
        editingManager.enableIdentify();
        if (mapCanvas) mapCanvas.style.cursor = 'help';
        break;
    }
  }

  // ---- Map control buttons ----
  _bindMapControls() {
    const map = mapManager.map;

    document.getElementById('ctrl-zoom-in')?.addEventListener('click', () => {
      mapManager.map?.zoomIn();
    });

    document.getElementById('ctrl-zoom-out')?.addEventListener('click', () => {
      mapManager.map?.zoomOut();
    });

    document.getElementById('ctrl-home')?.addEventListener('click', () => {
      mapManager.map?.flyTo({ center: [-63.2, 45.0], zoom: 7, duration: 800 });
    });

    document.getElementById('ctrl-location')?.addEventListener('click', () => {
      if (!navigator.geolocation) {
        bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: 'Geolocation not available' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          mapManager.map?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 });
          bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Zoomed to your location' });
        },
        () => bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: 'Location access denied' }),
      );
    });

    document.getElementById('ctrl-fullscreen')?.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    });
  }

  // ---- File inputs ----
  _bindFileInputs() {
    document.getElementById('file-input-data')?.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files);
      if (files.length) await importManager.importFiles(files);
      e.target.value = '';
    });

    document.getElementById('file-input-project')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'mapkg') {
        await packageManager.importPackage(file);
      } else {
        await projectManager.loadFromFile(file);
      }
      e.target.value = '';
    });
  }

  // ---- Drag and drop ----
  _bindDragDrop() {
    const overlay = document.createElement('div');
    overlay.className = 'drop-overlay';
    overlay.innerHTML = `<div class="drop-overlay-text">
      <div style="font-size:24px;margin-bottom:8px">📂</div>
      <div>Drop files to add layers</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:4px">GeoJSON, Shapefile ZIP, GeoTIFF, CSV, KML, GPX, MBTiles, GeoPDF</div>
    </div>`;
    document.body.appendChild(overlay);

    document.addEventListener('dragenter', (e) => {
      if (e.dataTransfer.types.includes('Files')) overlay.classList.add('active');
    });
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) overlay.classList.remove('active');
    });
    document.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      overlay.classList.remove('active');
      const files = Array.from(e.dataTransfer.files);
      if (!files.length) return;
      // Check if any file is a project/package
      const projectFiles = files.filter(f => /\.(json|mapkg)$/.test(f.name));
      const dataFiles = files.filter(f => !/\.(json|mapkg)$/.test(f.name));
      for (const f of projectFiles) {
        if (f.name.endsWith('.mapkg')) await packageManager.importPackage(f);
        else await projectManager.loadFromFile(f);
      }
      if (dataFiles.length) await importManager.importFiles(dataFiles);
    });
  }

  // ---- Resize handle (TOC panel) ----
  _bindResizeHandle() {
    const handle = document.getElementById('toc-resize-handle');
    const toc = document.getElementById('toc-panel');
    if (!handle || !toc) return;

    let dragging = false;
    let startX, startW;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = toc.offsetWidth;
      handle.classList.add('active');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newW = Math.max(160, Math.min(600, startW + e.clientX - startX));
      toc.style.width = `${newW}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('active');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    });
  }

  // ---- Keyboard shortcuts ----
  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Skip if in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === 's') {
        e.preventDefault();
        projectManager.saveToFile();
      } else if (ctrl && e.key === 'o') {
        e.preventDefault();
        document.getElementById('file-input-project')?.click();
      } else if (ctrl && e.key === 'n') {
        e.preventDefault();
        projectManager.newProject();
      } else if (e.key === 'Escape') {
        // Return to select tool
        this._setActiveTool('select');
        editingManager.stopMeasure?.();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        editingManager.deleteSelected();
      } else if (e.key === '1') this._setActiveTool('select');
      else if (e.key === '2') this._setActiveTool('draw_point');
      else if (e.key === '3') this._setActiveTool('draw_line_string');
      else if (e.key === '4') this._setActiveTool('draw_polygon');
      else if (e.key === 'i') this._setActiveTool('identify');
      else if (e.key === 'm') this._setActiveTool('measure');
    });
  }
}

export const app = new App();
