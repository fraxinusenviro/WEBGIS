import { bus, EVENTS } from '../utils/EventBus.js';
import { serviceConnector } from '../io/ServiceConnector.js';
import { openModal, closeModal } from './Modal.js';

const SERVICE_TYPES = [
  { id: 'wms',          label: 'WMS',         desc: 'Web Map Service (OGC)' },
  { id: 'wmts',         label: 'WMTS',        desc: 'Web Map Tile Service (OGC)' },
  { id: 'xyz',          label: 'XYZ / TMS',   desc: 'Tile URL template {z}/{x}/{y}' },
  { id: 'esri-feature', label: 'ESRI Feature', desc: 'ArcGIS Feature Service' },
  { id: 'esri-map',     label: 'ESRI Map',    desc: 'ArcGIS Map/Image Service' },
  { id: 'wfs',          label: 'WFS',         desc: 'Web Feature Service (OGC)' },
  { id: 'cog',          label: 'COG',         desc: 'Cloud-Optimized GeoTIFF (URL)' },
];

// Preset services for quick access
const PRESETS = [
  // General basemaps
  { group: 'General', name: 'OpenStreetMap', type: 'xyz', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors' },
  { group: 'General', name: 'OpenTopoMap', type: 'xyz', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '© OpenTopoMap' },
  { group: 'General', name: 'ESRI World Imagery', type: 'xyz', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: '© Esri, Maxar' },
  { group: 'General', name: 'ESRI World Street Map', type: 'esri-map', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer' },
  { group: 'General', name: 'ESRI World Imagery (REST)', type: 'esri-map', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer' },
  { group: 'General', name: 'USGS Topo', type: 'xyz', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', attribution: '© USGS' },
  { group: 'General', name: 'USGS Imagery', type: 'xyz', url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', attribution: '© USGS' },
  { group: 'General', name: 'Stadia Stamen Terrain', type: 'xyz', url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.jpg', attribution: '© Stadia Maps, Stamen' },
  // NASA
  { group: 'NASA', name: 'NASA GIBS MODIS Terra (WMS)', type: 'wms', url: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi', layers: 'MODIS_Terra_CorrectedReflectance_TrueColor' },
  { group: 'NASA', name: 'NASA Blue Marble', type: 'xyz', url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg', attribution: '© NASA' },
  // USGS
  { group: 'USGS', name: 'USGS National Streamflow Stations (WFS)', type: 'wfs', url: 'https://labs.waterdata.usgs.gov/geoserver/wmadata/ows' },
  { group: 'USGS', name: 'USGS TNM Topo (WMS)', type: 'wms', url: 'https://basemap.nationalmap.gov/arcgis/services/USGSTopo/MapServer/WMSServer' },
  // Canada
  { group: 'Canada', name: 'NRCan DTM Hillshade (WMS)', type: 'wms', url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic', layers: 'dtm-hillshade' },
  { group: 'Canada', name: 'NRCan DSM Hillshade (WMS)', type: 'wms', url: 'https://datacube.services.geo.ca/wrapper/ogc/elevation-hrdem-mosaic', layers: 'dsm-hillshade' },
  // Nova Scotia
  { group: 'Nova Scotia', name: 'NS Property Registry NSPRD (WMS)', type: 'wms', url: 'https://nsgiwa2.novascotia.ca/arcgis/services/PLAN/PLAN_NSPRD_NoLabels_UT83/MapServer/WMSServer' },
  { group: 'Nova Scotia', name: 'NS Crown Parcels (WMS)', type: 'wms', url: 'https://nsgiwa.novascotia.ca/arcgis/services/PLAN/PLAN_SimplifiedCrownParcels_UT83/MapServer/WMSServer' },
  // Other
  { group: 'Other', name: 'ESRI World Imagery (WMTS)', type: 'wmts', url: 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/WMTS/1.0.0/WMTSCapabilities.xml' },
  { group: 'Other', name: 'Example COG – NOAA Harvey', type: 'cog', url: 'https://noaa-emergency-response.s3.amazonaws.com/storms/harvey_2017/cog/20170901_NOAA_Harvey_TX_1m.tif' },
];

export class ServiceDialog {
  constructor() {
    bus.on(EVENTS.SHOW_SERVICE_DIALOG, () => this.open());
  }

  open() {
    let selectedType = 'wms';

    const content = document.createElement('div');

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.innerHTML = `
      <div class="tab active" data-tab="manual">Manual</div>
      <div class="tab" data-tab="presets">Presets</div>
    `;
    content.appendChild(tabs);

    const manualTab = document.createElement('div');
    manualTab.id = 'tab-manual';
    manualTab.innerHTML = `
      <div style="margin-bottom:12px">
        <label class="form-label">Service Type</label>
        <div class="service-type-grid" id="svc-type-grid">
          ${SERVICE_TYPES.map(t => `
            <button class="service-type-btn${t.id === 'wms' ? ' active' : ''}" data-type="${t.id}" title="${t.desc}">${t.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Layer Name (optional)</label>
        <input type="text" class="form-input" id="svc-name" placeholder="Auto-detect">
      </div>
      <div class="form-group">
        <label class="form-label">Service URL</label>
        <div style="display:flex;gap:6px">
          <input type="url" class="form-input" id="svc-url" placeholder="https://..." style="flex:1">
          <button class="btn btn-secondary" id="svc-probe" title="Probe/inspect service">Probe</button>
        </div>
        <p class="form-hint" id="svc-hint">Enter the base URL of the service</p>
      </div>
      <div id="svc-wms-opts">
        <div class="form-group">
          <label class="form-label">Layer Name(s)</label>
          <div style="display:flex;gap:6px">
            <input type="text" class="form-input" id="svc-wms-layers" placeholder="layer1,layer2" style="flex:1">
          </div>
          <p class="form-hint">Comma-separated WMS layer names</p>
        </div>
        <div class="form-group">
          <label class="form-label">Version</label>
          <select class="form-select" id="svc-wms-version">
            <option value="1.3.0">1.3.0</option>
            <option value="1.1.1">1.1.1</option>
          </select>
        </div>
        <div id="svc-wms-layer-list" style="max-height:160px;overflow-y:auto;display:none">
          <p class="form-hint" style="margin-bottom:6px">Available layers:</p>
          <div id="svc-wms-available"></div>
        </div>
      </div>
      <div id="svc-xyz-opts" style="display:none">
        <div class="form-group">
          <label class="form-label">Attribution</label>
          <input type="text" class="form-input" id="svc-xyz-attr" placeholder="© Provider">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Min Zoom</label>
            <input type="number" class="form-input" id="svc-xyz-min" value="0" min="0" max="22">
          </div>
          <div class="form-group">
            <label class="form-label">Max Zoom</label>
            <input type="number" class="form-input" id="svc-xyz-max" value="20" min="0" max="22">
          </div>
        </div>
      </div>
      <div id="svc-esri-opts" style="display:none">
        <div class="form-group">
          <label class="form-label">Out Fields</label>
          <input type="text" class="form-input" id="svc-esri-fields" value="*" placeholder="*">
          <p class="form-hint">Comma-separated field names or * for all</p>
        </div>
      </div>
      <div id="svc-wmts-opts" style="display:none">
        <div class="form-group">
          <label class="form-label">Layer</label>
          <input type="text" class="form-input" id="svc-wmts-layer" placeholder="Layer identifier">
        </div>
        <div class="form-group">
          <label class="form-label">Tile Matrix Set</label>
          <input type="text" class="form-input" id="svc-wmts-tms" value="EPSG:3857" placeholder="EPSG:3857">
        </div>
        <p class="form-hint">Or enter a direct tile URL template with {z}/{x}/{y}</p>
      </div>
    `;
    content.appendChild(manualTab);

    // Build grouped preset HTML
    const groups = {};
    for (const p of PRESETS) {
      const g = p.group || 'Other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }
    const groupedHtml = Object.entries(groups).map(([groupName, items]) => `
      <div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);padding:4px 0 6px">${groupName}</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          ${items.map(p => `
            <button class="btn btn-secondary preset-btn" data-type="${p.type}" data-url="${encodeURIComponent(p.url)}" data-layers="${p.layers || ''}" data-attribution="${p.attribution || ''}" style="justify-content:flex-start;text-align:left">
              <div>
                <div style="font-weight:500;font-size:12px">${p.name}</div>
                <div style="font-size:10px;color:var(--text-muted)">${p.type.toUpperCase()} · ${p.url.slice(0, 50)}…</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    const presetsTab = document.createElement('div');
    presetsTab.id = 'tab-presets';
    presetsTab.style.display = 'none';
    presetsTab.innerHTML = `
      <p class="form-hint" style="margin-bottom:10px">Click a preset to add it directly:</p>
      <div style="overflow-y:auto;max-height:400px">
        ${groupedHtml}
      </div>
    `;
    content.appendChild(presetsTab);

    const footer = document.createElement('div');
    footer.innerHTML = `
      <button class="btn btn-ghost" id="svc-cancel">Cancel</button>
      <button class="btn btn-primary" id="svc-add">Add Layer</button>
    `;

    const modal = openModal({ title: 'Add Web Service', content, footer, width: 500 });

    // Tab switching
    tabs.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        manualTab.style.display = tab.dataset.tab === 'manual' ? 'block' : 'none';
        presetsTab.style.display = tab.dataset.tab === 'presets' ? 'block' : 'none';
      });
    });

    // Service type selection
    modal.querySelectorAll('.service-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.service-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedType = btn.dataset.type;
        this._updateOpts(modal, selectedType);
      });
    });

    // Probe button
    modal.querySelector('#svc-probe')?.addEventListener('click', async () => {
      const url = modal.querySelector('#svc-url')?.value?.trim();
      if (!url) return;
      try {
        bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Probing service…' });
        if (selectedType === 'wms') {
          const layers = await serviceConnector.probeWMS(url);
          this._showWMSLayers(modal, layers);
        } else if (selectedType.startsWith('esri')) {
          const info = await serviceConnector.probeESRI(url);
          modal.querySelector('#svc-name').value = info.name;
          bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Found: ${info.type} — ${info.name}` });
        }
      } catch(e) {
        bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Probe failed: ${e.message}` });
      }
    });

    // Preset buttons
    modal.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        closeModal();
        const type = btn.dataset.type;
        const url = btn.dataset.url;
        const name = btn.querySelector('div div:first-child')?.textContent;
        await this._addService(type, url, { name });
      });
    });

    // Add layer button
    modal.querySelector('#svc-add')?.addEventListener('click', async () => {
      const url = modal.querySelector('#svc-url')?.value?.trim();
      if (!url) { bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: 'Please enter a URL' }); return; }
      closeModal();
      const params = this._collectParams(modal, selectedType);
      await this._addService(selectedType, url, params);
    });

    modal.querySelector('#svc-cancel')?.addEventListener('click', closeModal);
  }

  _updateOpts(modal, type) {
    modal.querySelector('#svc-wms-opts').style.display = type === 'wms' ? 'block' : 'none';
    modal.querySelector('#svc-xyz-opts').style.display = type === 'xyz' ? 'block' : 'none';
    modal.querySelector('#svc-esri-opts').style.display = type.startsWith('esri') ? 'block' : 'none';
    modal.querySelector('#svc-wmts-opts').style.display = type === 'wmts' ? 'block' : 'none';

    const hints = {
      wms: 'WMS base URL (GetCapabilities will be probed)',
      wmts: 'WMTS GetCapabilities URL or direct tile URL template',
      xyz: 'Tile URL with {z}/{x}/{y} placeholders',
      'esri-feature': 'ArcGIS Feature Service REST endpoint (ends with /FeatureServer/0)',
      'esri-map': 'ArcGIS Map/Image Service REST endpoint',
      wfs: 'WFS base URL',
      cog: 'Direct URL to Cloud-Optimized GeoTIFF (.tif)',
    };
    const hint = modal.querySelector('#svc-hint');
    if (hint) hint.textContent = hints[type] || '';
  }

  _showWMSLayers(modal, layers) {
    const container = modal.querySelector('#svc-wms-layer-list');
    const available = modal.querySelector('#svc-wms-available');
    if (!container || !available) return;

    available.innerHTML = layers.slice(0, 50).map(l => `
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;font-size:12px">
        <input type="checkbox" class="wms-layer-chk" value="${l.name}">
        <span title="${l.name}"><strong>${l.name}</strong> — ${l.title}</span>
      </label>
    `).join('') + (layers.length > 50 ? `<p class="form-hint">…and ${layers.length - 50} more</p>` : '');

    available.querySelectorAll('.wms-layer-chk').forEach(chk => {
      chk.addEventListener('change', () => {
        const selected = Array.from(available.querySelectorAll('.wms-layer-chk:checked')).map(c => c.value);
        const layersInput = modal.querySelector('#svc-wms-layers');
        if (layersInput) layersInput.value = selected.join(',');
      });
    });

    container.style.display = 'block';
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Found ${layers.length} WMS layers` });
  }

  _collectParams(modal, type) {
    const g = (id) => modal.querySelector(`#${id}`)?.value?.trim() || '';
    const name = g('svc-name');

    if (type === 'wms') {
      return {
        name: name || g('svc-wms-layers') || 'WMS Layer',
        layers: g('svc-wms-layers'),
        version: g('svc-wms-version') || '1.3.0',
      };
    }
    if (type === 'wmts') {
      return { name: name || 'WMTS Layer', layer: g('svc-wmts-layer'), tilematrixset: g('svc-wmts-tms') || 'EPSG:3857' };
    }
    if (type === 'xyz') {
      return { name: name || 'XYZ Tiles', attribution: g('svc-xyz-attr'), minzoom: parseInt(g('svc-xyz-min')||0), maxzoom: parseInt(g('svc-xyz-max')||20) };
    }
    if (type === 'esri-feature') {
      return { name: name || 'ESRI Feature Layer', outFields: g('svc-esri-fields') || '*' };
    }
    if (type === 'esri-map') {
      return { name: name || 'ESRI Map Service' };
    }
    if (type === 'wfs') {
      return { name: name || 'WFS Layer', typeName: g('svc-wms-layers') };
    }
    if (type === 'cog') {
      return { name: name || 'COG Layer' };
    }
    return { name };
  }

  async _addService(type, url, params) {
    try {
      switch(type) {
        case 'wms':          await serviceConnector.addWMS(url, params); break;
        case 'wmts':         await serviceConnector.addWMTS(url, params); break;
        case 'xyz':          await serviceConnector.addXYZ(url, params); break;
        case 'esri-feature': await serviceConnector.addESRIFeatureService(url, params); break;
        case 'esri-map':     await serviceConnector.addESRIMapService(url, params); break;
        case 'wfs':          await serviceConnector.addWFS(url, params); break;
        case 'cog':          await serviceConnector.addCOG(url, params); break;
        default: bus.emit(EVENTS.SHOW_TOAST, { type: 'warning', message: `Unknown service type: ${type}` });
      }
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Failed to add service: ${e.message}` });
    }
  }
}
