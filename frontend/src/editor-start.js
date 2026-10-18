import { t } from './i18n.js';

// A non-modal starting point. Never replaces an existing plan or hides tools.
export function installEditorStart(editor) {
  const app = editor.app;
  const box = document.createElement('section');
  box.className = 'editor-start edit-only';
  box.hidden = true;
  box.setAttribute('aria-labelledby', 'editorStartTitle');
  app.shadowRoot.append(box);
  const dismissed = new WeakSet();
  let languageText = '';
  box.addEventListener('click', (event) => {
    const action = event.target.closest('[data-start]')?.dataset.start;
    if (!action) return;
    if (action === 'plan') {
      app.wizard.open({ levelId: editor.level.id });
      app.$('wizard').querySelector('button,input')?.focus();
    } else {
      dismissed.add(app.plan);
      box.hidden = true;
      if (action === 'draw') { editor.setView2d(true); editor.setTool('poly'); }
      app.$('edBar').querySelector(action === 'draw' ? '[data-tool="poly"]' : '#tPlan')?.focus();
    }
  });
  return () => {
    const empty = app.plan?.levels?.length && app.plan.levels.every(level =>
      !level.rooms?.length && !level.furniture?.length && !level.devices?.length && !level.openings?.length && !level.underlay);
    box.hidden = app.mode !== 'edit' || !empty || editor.tool !== 'select' || dismissed.has(app.plan);
    if (box.hidden) return;
    const title = t('editor.start.title');
    if (title === languageText) return;
    languageText = title;
    box.replaceChildren();
    const heading = document.createElement('h2'); heading.id = 'editorStartTitle'; heading.textContent = title;
    const intro = document.createElement('p'); intro.textContent = t('editor.start.description');
    const steps = document.createElement('p'); steps.className = 'hint'; steps.textContent = t('editor.start.steps');
    const actions = document.createElement('div'); actions.className = 'actions';
    for (const [action, key] of [['plan','editor.start.plan'],['draw','editor.start.draw'],['dismiss','editor.start.dismiss']]) {
      const button = document.createElement('button'); button.className = `btn ${action === 'plan' ? 'primary' : ''}`;
      button.dataset.start = action; button.textContent = t(key); actions.append(button);
    }
    const example = document.createElement('a'); example.href = 'https://knaackee.github.io/hometwin/demo/';
    example.target = '_blank'; example.rel = 'noopener'; example.textContent = t('editor.start.example');
    const note = document.createElement('p'); note.className = 'hint'; note.textContent = t('editor.start.aiNote');
    box.append(heading,intro,steps,actions,note,example);
  };
}
