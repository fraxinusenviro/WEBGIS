import { bus, EVENTS } from '../utils/EventBus.js';

/**
 * IdentifyPanel — shows feature attributes when clicking the map
 */
export class IdentifyPanel {
  constructor() {
    this._popup = document.getElementById('identify-popup');
    bus.on(EVENTS.SHOW_IDENTIFY, (data) => this.show(data));
  }

  show({ lngLat, features, screenPoint }) {
    if (!features?.length || !this._popup) return;

    const f = features[0];
    const props = f.properties || {};

    const rows = Object.entries(props)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => `
        <div class="identify-attr-row">
          <span class="identify-attr-key" title="${k}">${k}</span>
          <span class="identify-attr-val">${v === null || v === undefined ? '—' : String(v)}</span>
        </div>
      `).join('');

    this._popup.innerHTML = `
      <div class="identify-popup-header">
        <span>${f.layer?.id?.split('-')[0] || 'Feature'} (${features.length})</span>
        <button class="identify-popup-close">×</button>
      </div>
      <div class="identify-popup-body">
        ${rows || '<p style="color:var(--text-muted);font-size:12px">No attributes</p>'}
        ${features.length > 1 ? `
          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text-muted)">
            ${features.length} features at this location
          </div>
        ` : ''}
      </div>
    `;

    // Position near click but within viewport
    const x = Math.min(screenPoint.x + 12, window.innerWidth - 340);
    const y = Math.min(screenPoint.y - 10, window.innerHeight - 300);
    this._popup.style.left = `${x}px`;
    this._popup.style.top = `${y}px`;
    this._popup.classList.remove('hidden');

    this._popup.querySelector('.identify-popup-close').addEventListener('click', () => {
      this._popup.classList.add('hidden');
    });
  }

  hide() {
    this._popup?.classList.add('hidden');
  }
}
