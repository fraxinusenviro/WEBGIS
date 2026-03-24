/**
 * EventBus — simple pub/sub for decoupled component communication
 */
class EventBus {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler); // returns unsubscribe fn
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event, data) {
    this._listeners.get(event)?.forEach(h => {
      try { h(data); } catch(e) { console.error(`EventBus error [${event}]:`, e); }
    });
  }

  once(event, handler) {
    const unsub = this.on(event, (data) => {
      handler(data);
      unsub();
    });
  }
}

export const bus = new EventBus();

// Event name constants
export const EVENTS = {
  // Layer events
  LAYER_ADDED:        'layer:added',
  LAYER_REMOVED:      'layer:removed',
  LAYER_UPDATED:      'layer:updated',
  LAYER_VISIBILITY:   'layer:visibility',
  LAYER_ORDER:        'layer:order',
  LAYER_SELECTED:     'layer:selected',
  LAYER_STYLE_CHANGE: 'layer:styleChange',

  // Map events
  MAP_READY:          'map:ready',
  MAP_MOVE:           'map:move',
  MAP_CLICK:          'map:click',
  MAP_BASEMAP:        'map:basemap',

  // Project events
  PROJECT_NEW:        'project:new',
  PROJECT_LOADED:     'project:loaded',
  PROJECT_SAVED:      'project:saved',
  PROJECT_DIRTY:      'project:dirty',

  // Edit events
  EDIT_MODE:          'edit:mode',
  EDIT_FEATURE_ADDED: 'edit:featureAdded',
  EDIT_FEATURE_UPDATED: 'edit:featureUpdated',
  EDIT_FEATURE_DELETED: 'edit:featureDeleted',
  EDIT_COMMIT:        'edit:commit',

  // UI events
  SHOW_TOAST:         'ui:toast',
  SHOW_MODAL:         'ui:modal',
  CLOSE_MODAL:        'ui:closeModal',
  SHOW_ATTR_TABLE:    'ui:attrTable',
  SHOW_SYMBOLOGY:     'ui:symbology',
  SHOW_GP_PANEL:      'ui:gpPanel',
  SHOW_SERVICE_DIALOG:'ui:serviceDialog',
  SHOW_IDENTIFY:      'ui:identify',
};
