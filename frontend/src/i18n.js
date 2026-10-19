import robotsEn from './locales/robots.en.json' with { type: 'json' };
import robotsDe from './locales/robots.de.json' with { type: 'json' };
import mediaEn from './locales/media.en.json' with { type: 'json' };
import mediaDe from './locales/media.de.json' with { type: 'json' };
import panelEn from './locales/panel.en.json' with { type: 'json' };
import panelDe from './locales/panel.de.json' with { type: 'json' };
import editorEn from './locales/editor.en.json' with { type: 'json' };
import editorDe from './locales/editor.de.json' with { type: 'json' };
import assistantEn from './locales/assistant.en.json' with { type: 'json' };
import assistantDe from './locales/assistant.de.json' with { type: 'json' };
import dataEn from './locales/data.en.json' with { type: 'json' };
import dataDe from './locales/data.de.json' with { type: 'json' };

const messages = {
  en: { ...panelEn, ...editorEn, ...assistantEn, ...dataEn, ...mediaEn, ...robotsEn },
  de: { ...panelDe, ...editorDe, ...assistantDe, ...dataDe, ...mediaDe, ...robotsDe },
};
let language = 'en';

export function setLanguage(value) {
  language = Object.hasOwn(messages, value) ? value : 'en';
  return language;
}
export const getLanguage = () => language;
export const getLocale = () => language === 'de' ? 'de-DE' : 'en-US';
export function t(key, params = {}) {
  const message = messages[language][key] ?? messages.en[key] ?? key;
  return message.replace(/\{([a-zA-Z][\w]*)\}/g, (token, name) =>
    Object.hasOwn(params, name) ? String(params[name]) : token);
}
export function localize(values) {
  return values?.[language] || values?.en || '';
}
export const formatNumber = (value, options = {}) => new Intl.NumberFormat(getLocale(), options).format(value);
