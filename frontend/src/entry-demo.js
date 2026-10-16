import './panel.js';
import { createDemoHass } from './sim.js';

const el = document.createElement('hometwin-panel');
el.narrow = window.innerWidth < 820;
el.panel = { config: {} };
document.getElementById('app').appendChild(el);
el.hass = createDemoHass((h) => { el.hass = h; });
