import './panel.js';
import { createDemoHass } from './sim.js';
import { t } from './i18n.js';

const el = document.createElement('hometwin-panel');
el.narrow = window.innerWidth < 820;
const requestedLanguage = new URLSearchParams(window.location.search).get('lang');
let savedLanguage;
try { savedLanguage = localStorage.getItem('hometwin.ui_language'); } catch { /* Storage may be unavailable. */ }
const uiLanguage = ['en', 'de'].includes(requestedLanguage) ? requestedLanguage : savedLanguage === 'de' ? 'de' : 'en';
el.addEventListener('hometwin-language-changed', ({ detail }) => {
  document.documentElement.lang = detail;
  document.title = t('data.demo.title');
  const url = new URL(location.href); url.searchParams.delete('lang'); history.replaceState(null, '', url);
});
document.documentElement.lang = uiLanguage;
el.panel = { config: { ui_language: uiLanguage } };
document.title = t('data.demo.title');
document.getElementById('app').appendChild(el);
el.hass = createDemoHass((h) => { el.hass = h; });
