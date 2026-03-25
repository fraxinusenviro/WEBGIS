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
    mapManager.init('map', { basemap: 'osm', center: [0, 20], zoom: 3 });

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

    // Wire panel resize handle
    this._bindResizeHandle();

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

    // Add default OSM basemap
    basemapLayerManager.addBasemap('osm');
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
      this._dataCatalog.open();
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
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-danger" id="settings-clear-storage">Clear All Stored Data</button>
      </div>
    `;
    openModal({ title: 'Settings', content, width: 380 });

    content.querySelector('#settings-proj-name')?.addEventListener('change', (e) => {
      projectManager.setName(e.target.value);
    });

    content.querySelector('#settings-clear-storage')?.addEventListener('click', async () => {
      if (confirm('This will delete all saved projects and layer data. Continue?')) {
        await storage.clearAllLayerData();
        bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Storage cleared' });
      }
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
      mapManager.map?.flyTo({ center: [0, 20], zoom: 3 });
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
