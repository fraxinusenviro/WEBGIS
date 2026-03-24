import { bus, EVENTS } from '../utils/EventBus.js';

const ICONS = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

/**
 * Toast notification system
 */
export function initToast() {
  bus.on(EVENTS.SHOW_TOAST, ({ type = 'info', message, duration = 4000 }) => {
    showToast(type, message, duration);
  });
}

export function showToast(type = 'info', message = '', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${ICONS[type] || ICONS.info}</span><span>${message}</span>`;

  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('fading');
    toast.addEventListener('animationend', () => toast.remove());
  };

  const timer = setTimeout(remove, duration);
  toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
}
