import { bus, EVENTS } from '../utils/EventBus.js';
import { layerManager } from '../layers/LayerManager.js';
import { mapManager } from '../map/MapManager.js';
import { storage } from '../storage/StorageManager.js';
import { uid } from '../utils/uid.js';

/**
 * ProjectManager — save/load projects as JSON
 *
 * Project JSON format:
 * {
 *   "version": "1.0.0",
 *   "name": "My Project",
 *   "created": "ISO8601",
 *   "modified": "ISO8601",
 *   "mapState": { center, zoom, bearing, pitch },
 *   "basemap": "osm",
 *   "layers": [...serialized layers...]
 * }
 */
export class ProjectManager {
  constructor() {
    this._currentProject = this._defaultProject();
    this._dirty = false;
    this._autoSaveInterval = null;

    bus.on(EVENTS.PROJECT_DIRTY, () => {
      this._dirty = true;
      this._updateTitle();
    });
  }

  _defaultProject() {
    return {
      id: uid('proj'),
      version: '1.0.0',
      name: 'Untitled Project',
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      mapState: { center: [0, 20], zoom: 3, bearing: 0, pitch: 0 },
      basemap: 'osm',
      layers: [],
    };
  }

  get currentProject() { return { ...this._currentProject }; }
  get isDirty() { return this._dirty; }

  setName(name) {
    this._currentProject.name = name;
    this._dirty = true;
    this._updateTitle();
    bus.emit(EVENTS.PROJECT_DIRTY);
  }

  // ---- New Project ----
  async newProject() {
    if (this._dirty) {
      const confirmed = confirm('You have unsaved changes. Start a new project?');
      if (!confirmed) return;
    }
    await layerManager.clearAll();
    this._currentProject = this._defaultProject();
    this._dirty = false;
    this._updateTitle();
    bus.emit(EVENTS.PROJECT_NEW, this._currentProject);
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'New project created' });
  }

  // ---- Save ----
  async save(asNew = false) {
    if (asNew) {
      this._currentProject.id = uid('proj');
      this._currentProject.created = new Date().toISOString();
    }
    this._currentProject.modified = new Date().toISOString();
    this._currentProject.mapState = mapManager.getState();
    this._currentProject.basemap = mapManager.getCurrentBasemap();

    // Serialize layers (without embedded data — data stored separately in IndexedDB)
    this._currentProject.layers = layerManager.serialize(false);

    await storage.saveProject(this._currentProject.id, this._currentProject);
    await storage.autoSave(this._currentProject);

    this._dirty = false;
    this._updateTitle();
    bus.emit(EVENTS.PROJECT_SAVED, this._currentProject);
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Project saved: ${this._currentProject.name}` });
  }

  // ---- Save to JSON file ----
  saveToFile() {
    this._currentProject.modified = new Date().toISOString();
    this._currentProject.mapState = mapManager.getState();
    this._currentProject.basemap = mapManager.getCurrentBasemap();
    this._currentProject.layers = layerManager.serialize(true); // embed small data

    const json = JSON.stringify(this._currentProject, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._currentProject.name.replace(/[^a-z0-9_\-\s]/gi, '') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: 'Project exported to file' });
  }

  // ---- Load ----
  async loadFromStorage(projectId) {
    const project = await storage.loadProject(projectId);
    if (!project) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: 'Project not found' });
      return;
    }
    await this._applyProject(project);
  }

  async loadFromFile(file) {
    try {
      const text = await file.text();
      const project = JSON.parse(text);
      if (!project.version || !project.layers) throw new Error('Invalid project file');
      await this._applyProject(project);
    } catch(e) {
      bus.emit(EVENTS.SHOW_TOAST, { type: 'error', message: `Failed to load project: ${e.message}` });
    }
  }

  async _applyProject(project) {
    await layerManager.clearAll();

    this._currentProject = { ...this._defaultProject(), ...project };

    // Restore map state
    if (project.mapState && mapManager.map) {
      mapManager.map.setCenter(project.mapState.center);
      mapManager.map.setZoom(project.mapState.zoom);
      if (project.mapState.bearing !== undefined) mapManager.map.setBearing(project.mapState.bearing);
      if (project.mapState.pitch !== undefined) mapManager.map.setPitch(project.mapState.pitch);
    }

    // Restore basemap
    if (project.basemap) {
      mapManager.setBasemap(project.basemap);
      const sel = document.getElementById('basemap-select');
      if (sel) sel.value = project.basemap;
    }

    // Restore layers
    if (project.layers?.length) {
      await layerManager.deserialize(project.layers);
    }

    this._dirty = false;
    this._updateTitle();
    bus.emit(EVENTS.PROJECT_LOADED, project);
    bus.emit(EVENTS.SHOW_TOAST, { type: 'success', message: `Loaded: ${project.name}` });
  }

  // ---- Auto-load last session ----
  async tryRestoreSession() {
    try {
      const autosave = await storage.loadAutoSave();
      if (autosave?.layers?.length) {
        const confirmed = confirm(`Restore previous session: "${autosave.name}"?`);
        if (confirmed) {
          await this._applyProject(autosave);
          return true;
        }
      }
    } catch(e) {}
    return false;
  }

  // ---- List saved projects ----
  async listSavedProjects() {
    return storage.listProjects();
  }

  // ---- Delete saved project ----
  async deleteProject(id) {
    await storage.deleteProject(id);
  }

  _updateTitle() {
    const el = document.getElementById('project-name-display');
    if (el) {
      el.textContent = this._currentProject.name + (this._dirty ? ' *' : '');
    }
    document.title = this._currentProject.name + ' — WebGIS';
  }

  startAutoSave(intervalMs = 60000) {
    this.stopAutoSave();
    this._autoSaveInterval = setInterval(async () => {
      if (this._dirty) {
        await this.save();
      }
    }, intervalMs);
  }

  stopAutoSave() {
    if (this._autoSaveInterval) {
      clearInterval(this._autoSaveInterval);
      this._autoSaveInterval = null;
    }
  }
}

export const projectManager = new ProjectManager();
