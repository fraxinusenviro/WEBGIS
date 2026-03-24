import JSZip from 'jszip';
import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { mapManager } from '../map/MapManager.js';
import { projectManager } from './ProjectManager.js';
import { importManager } from '../io/ImportManager.js';

/**
 * PackageManager — creates and reads .mapkg files
 *
 * .mapkg format is a ZIP archive containing:
 * ├── project.json      — full project definition
 * └── data/
 *     ├── layer-id-1.geojson   — embedded vector data
 *     ├── layer-id-2.geojson
 *     └── ...
 *
 * Web service layers (WMS, XYZ, etc.) are stored by URL only.
 * Vector data < 50MB is embedded. Image layers store their data URL.
 *
 * The .mapkg extension is registered to this application.
 */
export class PackageManager {

  async exportPackage(projectName) {
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Building map package…' });

    try {
      const zip = new JSZip();
      const dataFolder = zip.folder('data');

      const layers = layerManager.layers;
      const serializedLayers = [];

      for (const layer of layers) {
        const sl = {
          id: layer.id,
          name: layer.name,
          type: layer.type,
          geometryType: layer.geometryType,
          visible: layer.visible,
          opacity: layer.opacity,
          style: layer.style,
          url: layer.url,
          serviceParams: layer.serviceParams,
          bbox: layer.bbox,
          sourceFormat: layer.sourceFormat,
          metadata: layer.metadata,
          embedded: false,
        };

        // Embed vector data
        if (layer.type === 'vector' || layer.type === 'esri-feature') {
          if (layer.data) {
            const geojsonStr = JSON.stringify(layer.data);
            const sizeKB = geojsonStr.length / 1024;
            if (sizeKB < 50 * 1024) { // < 50 MB
              const filename = `${layer.id}.geojson`;
              dataFolder.file(filename, geojsonStr);
              sl.dataFile = filename;
              sl.embedded = true;
            } else {
              sl.dataInline = layer.data; // embed inline if small enough
            }
          }
        }

        // Embed raster image data (COG preview, GeoTIFF, GeoPDF)
        if (layer.imageUrl && layer.imageUrl.startsWith('data:')) {
          const base64 = layer.imageUrl.split(',')[1];
          const mimeMatch = layer.imageUrl.match(/^data:([^;]+);/);
          const mime = mimeMatch ? mimeMatch[1] : 'image/png';
          const ext = mime.split('/')[1] || 'png';
          const filename = `${layer.id}.${ext}`;
          dataFolder.file(filename, base64, { base64: true });
          sl.imageFile = filename;
          sl.embedded = true;
        }

        serializedLayers.push(sl);
      }

      const projectData = {
        version: '1.0.0',
        name: projectName || projectManager.currentProject.name,
        created: projectManager.currentProject.created,
        modified: new Date().toISOString(),
        mapState: mapManager.getState(),
        basemap: mapManager.getCurrentBasemap(),
        layers: serializedLayers,
        packageFormat: 'mapkg',
        packageVersion: '1.0.0',
      };

      zip.file('project.json', JSON.stringify(projectData, null, 2));
      zip.file('README.txt', buildReadme(projectData));

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
        comment: 'WebGIS Map Package - webgis.app',
      });

      const safeName = (projectData.name || 'project').replace(/[^a-z0-9_\-\s]/gi, '');
      const filename = `${safeName}.mapkg`;
      downloadBlob(blob, filename);

      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Package exported: ${filename}` });
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Package export failed: ${e.message}` });
      console.error(e);
    }
  }

  async importPackage(file) {
    bus.emit(EVENTS.SHOW_TOAST, { type: 'info', message: 'Loading map package…' });
    try {
      const zip = await JSZip.loadAsync(file);

      // Read project.json
      const projectFile = zip.file('project.json');
      if (!projectFile) throw new Error('Invalid map package: missing project.json');
      const projectJson = await projectFile.async('string');
      const project = JSON.parse(projectJson);

      // Resolve embedded data files
      for (const layer of (project.layers || [])) {
        if (layer.dataFile) {
          const dataFile = zip.file(`data/${layer.dataFile}`);
          if (dataFile) {
            const geojsonStr = await dataFile.async('string');
            layer.data = JSON.parse(geojsonStr);
          }
        }
        if (layer.imageFile) {
          const imgFile = zip.file(`data/${layer.imageFile}`);
          if (imgFile) {
            const b64 = await imgFile.async('base64');
            const ext = layer.imageFile.split('.').pop();
            const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            layer.imageUrl = `data:${mime};base64,${b64}`;
          }
        }
      }

      // Load into app
      await layerManager.clearAll();

      if (project.mapState && mapManager.map) {
        mapManager.map.setCenter(project.mapState.center);
        mapManager.map.setZoom(project.mapState.zoom);
        if (project.mapState.bearing !== undefined) mapManager.map.setBearing(project.mapState.bearing);
      }
      if (project.basemap) {
        mapManager.setBasemap(project.basemap);
        const sel = document.getElementById('basemap-select');
        if (sel) sel.value = project.basemap;
      }

      if (project.layers?.length) {
        await layerManager.deserialize(project.layers);
      }

      bus.emit(EVENTS.PROJECT_LOADED, project);
      bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Package loaded: ${project.name}` });
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Package import failed: ${e.message}` });
      console.error(e);
    }
  }
}

function buildReadme(project) {
  return `WebGIS Map Package
==================
Name: ${project.name}
Created: ${project.created}
Modified: ${project.modified}
Format Version: ${project.packageVersion}

Contents:
- project.json: Project definition including layer styles, visibility, and map state
- data/: Embedded vector and raster data files

To open: Load this .mapkg file in WebGIS Platform (File > Open / drag-and-drop)

Note: Web service layers (WMS, XYZ, ESRI REST, etc.) require internet connectivity.
Embedded local layers work offline.
`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const packageManager = new PackageManager();
