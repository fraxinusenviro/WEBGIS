import { bus, EVENTS } from '../utils/EventBus.js';

/**
 * Modal system
 */
let _activeModal = null;

export function openModal({ title, content, footer, width = 480, onClose }) {
  closeModal();

  const overlay = document.getElementById('modal-overlay');
  const container = document.getElementById('modal-container');

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.width = `${width}px`;
  modal.style.maxWidth = '95vw';

  modal.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${title}</span>
      <button class="modal-close" title="Close">×</button>
    </div>
    <div class="modal-body">${typeof content === 'string' ? content : ''}</div>
    ${footer ? `<div class="modal-footer">${typeof footer === 'string' ? footer : ''}</div>` : ''}
  `;

  if (typeof content !== 'string') {
    modal.querySelector('.modal-body').appendChild(content);
  }
  if (footer && typeof footer !== 'string') {
    modal.querySelector('.modal-footer').appendChild(footer);
  }

  modal.querySelector('.modal-close').addEventListener('click', () => closeModal(onClose));
  overlay.addEventListener('click', () => closeModal(onClose));

  // Prevent clicks inside modal from closing
  modal.addEventListener('click', e => e.stopPropagation());

  container.appendChild(modal);
  overlay.classList.remove('hidden');
  _activeModal = { modal, onClose };

  // Focus first input
  setTimeout(() => modal.querySelector('input, select, textarea, button')?.focus(), 50);

  return modal;
}

export function closeModal(callback) {
  const overlay = document.getElementById('modal-overlay');
  const container = document.getElementById('modal-container');
  overlay.classList.add('hidden');
  container.innerHTML = '';
  if (callback) callback();
  _activeModal = null;
}

export function isModalOpen() {
  return _activeModal !== null;
}

// ESC key to close
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _activeModal) {
    closeModal(_activeModal.onClose);
  }
});
