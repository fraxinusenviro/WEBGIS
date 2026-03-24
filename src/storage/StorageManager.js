import localforage from 'localforage';

/**
 * StorageManager — wraps localforage (IndexedDB) for project and layer data persistence
 */
class StorageManager {
  constructor() {
    this._projectStore = localforage.createInstance({ name: 'webgis', storeName: 'projects' });
    this._layerStore = localforage.createInstance({ name: 'webgis', storeName: 'layers' });
    this._settingsStore = localforage.createInstance({ name: 'webgis', storeName: 'settings' });
  }

  // ---- Projects ----
  async saveProject(id, projectData) {
    return this._projectStore.setItem(id, projectData);
  }

  async loadProject(id) {
    return this._projectStore.getItem(id);
  }

  async listProjects() {
    const keys = await this._projectStore.keys();
    const projects = [];
    for (const key of keys) {
      const p = await this._projectStore.getItem(key);
      projects.push({ id: key, name: p.name, modified: p.modified });
    }
    return projects.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  }

  async deleteProject(id) {
    return this._projectStore.removeItem(id);
  }

  // ---- Layer Data (for large datasets) ----
  async saveLayerData(layerId, data) {
    return this._layerStore.setItem(layerId, data);
  }

  async loadLayerData(layerId) {
    return this._layerStore.getItem(layerId);
  }

  async deleteLayerData(layerId) {
    return this._layerStore.removeItem(layerId);
  }

  async clearAllLayerData() {
    return this._layerStore.clear();
  }

  // ---- Settings ----
  async getSetting(key, defaultValue = null) {
    const val = await this._settingsStore.getItem(key);
    return val !== null ? val : defaultValue;
  }

  async setSetting(key, value) {
    return this._settingsStore.setItem(key, value);
  }

  // ---- Auto-save current project (quick slot) ----
  async autoSave(projectData) {
    return this.saveProject('__autosave__', { ...projectData, modified: new Date().toISOString() });
  }

  async loadAutoSave() {
    return this.loadProject('__autosave__');
  }

  // ---- Estimate storage used ----
  async estimateUsage() {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return {
        used: est.usage,
        quota: est.quota,
        usedMB: (est.usage / 1024 / 1024).toFixed(1),
        quotaMB: (est.quota / 1024 / 1024).toFixed(0),
      };
    }
    return null;
  }
}

export const storage = new StorageManager();
