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
import { RightPanel } from './ui/RightPanel.js';
import { feltManager } from './felt/FeltManager.js';
import { zoomToScale } from './utils/coordinates.js';

/**
 * App — main orchestrator
 */
export class App {
  constructor() {
    this._activeTool = 'select';
    this._tocPanel = null;
    this._symbologyPanel = null;
    this._rightPanel = null;
    this._gpPanel = null;
    this._serviceDialog = null;
    this._attrTable = null;
    this._identifyPanel = null;
  }

  async init() {
    initToast();

    // Init map (center = Nova Scotia by default)
    mapManager.init('map', {});

    bus.on(EVENTS.MAP_READY, () => this._onMapReady());

    // Init UI panels
    this._symbologyPanel = new SymbologyPanel();
    this._tocPanel = new TOCPanel();
    this._gpPanel = new GeoprocessingPanel();
    this._serviceDialog = new ServiceDialog();
    this._attrTable = new AttributeTable();
    this._identifyPanel = new IdentifyPanel();

    // Init tabbed right panel (Catalog + Symbology)
    this._rightPanel = new RightPanel(dataCatalog, this._symbologyPanel);

    // Wire up TOC internal resize handle (60/40 split)
    this._bindTOCInternalResize();

    // Wire toolbar buttons
    this._bindToolbar();
    this._bindMapTools();
    this._bindMapControls();
    this._bindFileInputs();
    this._bindDragDrop();
    this._bindResizeHandle();

    // TOC add layer button
    document.getElementById('btn-toc-add-layer')?.addEventListener('click', () => {
      document.getElementById('file-input-data')?.click();
    });

    // TOC collapse
    document.getElementById('btn-toc-collapse')?.addEventListener('click', () => {
      document.querySelectorAll('.layer-expand.open').forEach(el => el.classList.remove('open'));
    });

    // Zoom all
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

    this._bindKeyboard();
    projectManager.startAutoSave(60000);
  }

  _onMapReady() {
    const map = mapManager.map;
    const center = map.getCenter();
    const z = map.getZoom();
    document.getElementById('zoom-display').textContent = `Zoom: ${z.toFixed(2)}`;
    document.getElementById('scale-display').textContent = `1:${zoomToScale(z, center.lat).toLocaleString()}`;

    projectManager.tryRestoreSession();
    this._setActiveTool('select');

    // Default basemap stack for Nova Scotia fieldwork
    // Stack order (bottom→top rendered): OSM, HRDEM DTM HS, HRDEM DSM HS, ESRI Imagery, ESRI Imagery Hybrid, HRDEM DTM HS 40%
    // Active: ESRI Imagery Hybrid (active), HRDEM DTM Hillshade 40% (active)
    const defaultStack = [
      { presetId: 'osm',                  opacity: 1.0,  visible: false },
      { presetId: 'hrdem-dtm-hillshade',  opacity: 1.0,  visible: false },
      { presetId: 'hrdem-dsm-hillshade',  opacity: 1.0,  visible: false },
      { presetId: 'satellite',            opacity: 1.0,  visible: false },
      { presetId: 'esri-imagery-hybrid',  opacity: 1.0,  visible: true  },
      { presetId: 'hrdem-dtm-hillshade',  opacity: 0.4,  visible: true  },
    ];

    for (const item of defaultStack) {
      basemapLayerManager.addBasemap(item.presetId, {
        opacity: item.opacity,
        visible: item.visible,
        saturation: 0,
      });
    }
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────

  _bindToolbar() {
    document.getElementById('btn-new-project')?.addEventListener('click', () => {
      projectManager.newProject();
    });

    document.getElementById('btn-open-project')?.addEventListener('click', () => {
      document.getElementById('file-input-project')?.click();
    });

    document.getElementById('btn-save-project')?.addEventListener('click', () => {
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
      this._rightPanel.switchTab('catalog');
      this._rightPanel._expand();
    });

    document.getElementById('btn-attribute-table')?.addEventListener('click', () => {
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

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this._showSettings();
    });

    // Felt upload button
    document.getElementById('btn-felt-upload')?.addEventListener('click', () => {
      this._showFeltUploadDialog();
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
      <div class="section-title" style="margin-top:16px">Felt Integration</div>
      <div class="form-group">
        <label class="form-label">Felt API Key</label>
        <input type="password" class="form-input" id="settings-felt-key"
               placeholder="felt_pat_xxxx..." value="${feltManager.getApiKey()}"
               autocomplete="off">
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Get your API key at <strong>felt.com → Settings → API</strong>
        </p>
      </div>
      <div class="form-group">
        <label class="form-label">Default Felt Map ID</label>
        <input type="text" class="form-input" id="settings-felt-map"
               placeholder="AbCdEf123..." value="${feltManager.getMapId()}">
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Found in the Felt map URL: felt.com/map/<strong>MAP_ID</strong>
        </p>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-danger" id="settings-clear-storage">Clear All Stored Data</button>
      </div>
    `;
    openModal({ title: 'Settings', content, width: 420 });

    content.querySelector('#settings-proj-name')?.addEventListener('change', (e) => {
      projectManager.setName(e.target.value);
    });

    content.querySelector('#settings-felt-key')?.addEventListener('change', (e) => {
      feltManager.setApiKey(e.target.value);
    });

    content.querySelector('#settings-felt-map')?.addEventListener('change', (e) => {
      feltManager.setMapId(e.target.value);
    });

    content.querySelector('#settings-clear-storage')?.addEventListener('click', async () => {
      if (confirm('This will delete all saved projects and layer data. Continue?')) {
        await storage.clearAllLayerData();
        bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Storage cleared' });
      }
    });
  }

  _showFeltUploadDialog() {
    const vectorLayers = layerManager.layers.filter(
      l => l.type === 'vector' || l.type === 'esri-feature'
    );

    if (!feltManager.getApiKey() || !feltManager.getMapId()) {
      bus.emit(EVENTS.SHOW_TOAST, {
        type: 'warning',
        message: 'Configure your Felt API Key and Map ID in Settings first.',
      });
      this._showSettings();
      return;
    }

    if (!vectorLayers.length) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'No vector layers to upload.' });
      return;
    }

    const content = document.createElement('div');
    content.innerHTML = `
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
        Select a layer to upload to your Felt map.
        Symbology will be converted to Felt Style Language (FSL) and applied automatically.
      </p>
      ${vectorLayers.map(l => `
        <button class="btn btn-secondary w-full" data-id="${l.id}"
                style="margin-bottom:6px;justify-content:flex-start;gap:8px">
          <span style="font-size:11px;opacity:0.6">${geomEmoji(l.geometryType)}</span>
          <span>${l.name}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:auto">
            ${l.data?.features?.length || 0} features
          </span>
        </button>
      `).join('')}
      <div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">
        <p style="font-size:11px;color:var(--text-muted)">
          Uploading to map: <strong>${feltManager.getMapId()}</strong>
          &nbsp;•&nbsp;
          <a href="#" id="felt-open-map" style="color:var(--accent)">Open in Felt ↗</a>
        </p>
      </div>
    `;

    openModal({ title: 'Upload to Felt', content, width: 400 });

    content.querySelector('#felt-open-map')?.addEventListener('click', (e) => {
      e.preventDefault();
      feltManager.openMap();
    });

    content.querySelectorAll('button[data-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const layerId = btn.dataset.id;
        closeModal();
        try {
          await feltManager.uploadLayer(layerId);
        } catch (err) {
          bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Felt upload failed: ${err.message}` });
          console.error('Felt upload error:', err);
        }
      });
    });
  }

  // ── Map tool buttons ──────────────────────────────────────────────────────

  _bindMapTools() {
    document.querySelectorAll('.map-tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._setActiveTool(btn.dataset.tool);
      });
    });
  }

  _setActiveTool(tool) {
    this._activeTool = tool;
    document.querySelectorAll('.map-tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    editingManager.disableIdentify();
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

  // ── Map control buttons ────────────────────────────────────────────────────

  _bindMapControls() {
    document.getElementById('ctrl-zoom-in')?.addEventListener('click', () => {
      mapManager.map?.zoomIn();
    });

    document.getElementById('ctrl-zoom-out')?.addEventListener('click', () => {
      mapManager.map?.zoomOut();
    });

    // Home = Nova Scotia
    document.getElementById('ctrl-home')?.addEventListener('click', () => {
      mapManager.flyHome();
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

  // ── File inputs ───────────────────────────────────────────────────────────

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

  // ── Drag and drop ─────────────────────────────────────────────────────────

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
      const projectFiles = files.filter(f => /\.(json|mapkg)$/.test(f.name));
      const dataFiles    = files.filter(f => !/\.(json|mapkg)$/.test(f.name));
      for (const f of projectFiles) {
        if (f.name.endsWith('.mapkg')) await packageManager.importPackage(f);
        else await projectManager.loadFromFile(f);
      }
      if (dataFiles.length) await importManager.importFiles(dataFiles);
    });
  }

  // ── TOC panel horizontal resize ───────────────────────────────────────────

  _bindResizeHandle() {
    const handle = document.getElementById('toc-resize-handle');
    const toc = document.getElementById('toc-panel');
    if (!handle || !toc) return;

    let dragging = false, startX, startW;

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
      const newW = Math.max(180, Math.min(600, startW + e.clientX - startX));
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

  // ── TOC internal split resize (layers 60% / basemaps 40%) ────────────────

  _bindTOCInternalResize() {
    const handle = document.getElementById('toc-split-handle');
    const layerSection = document.getElementById('layer-section');
    const basemapSection = document.getElementById('basemap-section');
    if (!handle || !layerSection || !basemapSection) return;

    let dragging = false, startY, startH;

    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startH = layerSection.offsetHeight;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const tocH = document.getElementById('toc-panel').offsetHeight
                 - document.querySelector('.panel-header').offsetHeight
                 - document.querySelector('.panel-footer').offsetHeight
                 - handle.offsetHeight;
      const newH = Math.max(60, Math.min(tocH - 60, startH + e.clientY - startY));
      layerSection.style.flex = 'none';
      layerSection.style.height = `${newH}px`;
      basemapSection.style.flex = '1';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    });
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 's') { e.preventDefault(); projectManager.saveToFile(); }
      else if (ctrl && e.key === 'o') { e.preventDefault(); document.getElementById('file-input-project')?.click(); }
      else if (ctrl && e.key === 'n') { e.preventDefault(); projectManager.newProject(); }
      else if (e.key === 'Escape') {
        this._setActiveTool('select');
        editingManager.stopMeasure?.();
      }
      else if (e.key === 'Delete' || e.key === 'Backspace') editingManager.deleteSelected();
      else if (e.key === '1') this._setActiveTool('select');
      else if (e.key === '2') this._setActiveTool('draw_point');
      else if (e.key === '3') this._setActiveTool('draw_line_string');
      else if (e.key === '4') this._setActiveTool('draw_polygon');
      else if (e.key === 'i') this._setActiveTool('identify');
      else if (e.key === 'm') this._setActiveTool('measure');
    });
  }
}

function geomEmoji(geomType) {
  if (geomType === 'Polygon') return '▬';
  if (geomType === 'LineString') return '╱';
  return '●';
}

export const app = new App();
