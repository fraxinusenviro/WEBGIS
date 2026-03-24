import './styles/main.css';
import { app } from './App.js';

// Bootstrap the application
app.init().catch(err => {
  console.error('Failed to initialize WebGIS:', err);
  document.body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0d1a10;color:#e2f0e8;font-family:system-ui;gap:16px">
      <div style="font-size:48px">⚠</div>
      <div style="font-size:20px;font-weight:bold">WebGIS failed to start</div>
      <div style="font-size:14px;color:#8aab96;max-width:400px;text-align:center">${err.message}</div>
      <button onclick="location.reload()" style="background:#4ade80;color:#0d1a10;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-size:14px;font-weight:600">
        Reload
      </button>
    </div>
  `;
});
