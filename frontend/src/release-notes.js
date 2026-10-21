import releaseData from './releases.json' with { type: 'json' };
import { getLanguage, getLocale, t } from './i18n.js';

export const RELEASE_STORAGE_KEY = 'hometwin.releaseNotes.seenVersion';
export const RELEASES = Object.freeze(releaseData.releases);
export const CURRENT_RELEASE = RELEASES[0];

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:(?:-|\.?)(?:beta|b)[.-]?(\d+))?$/i;

function versionParts(value) {
  const match = VERSION.exec(String(value || '').trim());
  return match && [...match.slice(1, 4).map(Number), match[4] == null ? Infinity : Number(match[4])];
}

export function compareReleaseVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  if (!a || !b) return String(left) === String(right) ? 0 : null;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function shouldShowReleaseNotes(currentVersion, seenVersion) {
  if (!seenVersion) return true;
  return compareReleaseVersions(currentVersion, seenVersion) === 1;
}

function browserStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function translated(value) {
  return value?.[getLanguage()] || value?.en || '';
}

function releaseArticle(doc, release, latest) {
  const body = doc.createElement(latest ? 'section' : 'div');
  body.className = 'release-entry';
  const heading = doc.createElement('h3');
  heading.textContent = translated(release.title);
  const meta = doc.createElement('p');
  meta.className = 'release-meta';
  const date = new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeZone: 'UTC' })
    .format(new Date(`${release.date}T00:00:00Z`));
  meta.textContent = `HomeTwin ${release.version} · ${date}`;
  const list = doc.createElement('ul');
  for (const change of release.changes) {
    const item = doc.createElement('li');
    item.textContent = translated(change);
    list.append(item);
  }
  body.append(heading, meta, list);
  return body;
}

export const RELEASE_NOTES_CSS = `
.release-notes {
  width: min(620px, calc(100vw - 32px)); max-height: min(760px, calc(100dvh - 32px));
  padding: 0; border: 1px solid var(--line, #273042); border-radius: 18px;
  color: var(--fg, #e7ebf2); background: var(--panel-solid, #141a26);
  box-shadow: 0 24px 70px rgba(0, 0, 0, .28); overflow: hidden;
}
.release-notes[open] { display: flex; flex-direction: column; }
.release-notes::backdrop { background: rgba(12, 18, 25, .58); backdrop-filter: blur(2px); }
.release-notes__header { display: flex; flex: none; align-items: flex-start; gap: 16px; padding: 22px 24px 14px; }
.release-notes__heading { flex: 1; min-width: 0; }
.release-notes h2, .release-notes h3, .release-notes p { margin: 0; }
.release-notes h2 { font-size: 1.45rem; line-height: 1.2; }
.release-notes__intro { margin-top: 6px !important; color: var(--muted, #8d97ab); }
.release-notes__close { flex: 0 0 auto; width: 40px; height: 40px; border: 0; border-radius: 50%;
  color: inherit; background: var(--line-soft, #1d2433); font: inherit; font-size: 1.5rem; cursor: pointer; }
.release-notes__close:hover, .release-notes__close:focus-visible { background: var(--edit-soft, rgba(121,166,255,.14)); }
.release-notes__body { flex: 1; min-height: 0; padding: 0 24px 24px; overflow: auto; }
.release-entry { padding: 18px 0; border-top: 1px solid var(--line, #273042); }
.release-entry h3 { font-size: 1.05rem; line-height: 1.35; }
.release-meta { margin-top: 4px !important; color: var(--muted, #8d97ab); font-size: .82rem; }
.release-entry ul { margin: 14px 0 0; padding-left: 1.25rem; }
.release-entry li { margin: 8px 0; line-height: 1.45; }
.release-latest { display: inline-block; margin-bottom: 10px; padding: 4px 9px; border-radius: 999px;
  color: #0b1222; background: var(--edit, #79a6ff); font-size: .75rem; font-weight: 700; }
.release-older { border-top: 1px solid var(--line, #273042); }
.release-older summary { padding: 15px 4px; cursor: pointer; font-weight: 650; }
.release-older .release-entry { padding: 0 4px 18px; border: 0; }
.release-older .release-entry h3 { display: none; }
@media (max-width: 520px) {
  .release-notes { width: 100vw; max-width: none; max-height: calc(100dvh - 12px); margin: auto 0 0; border-radius: 18px 18px 0 0; }
  .release-notes__header { padding: 20px 18px 12px; }
  .release-notes__body { padding: 0 18px 18px; }
}
@media (prefers-reduced-motion: reduce) { .release-notes { scroll-behavior: auto; } }
`;

export function createReleaseNotes(root, { storage = browserStorage(), onOpen, onClose } = {}) {
  const doc = root?.ownerDocument || root?.host?.ownerDocument;
  if (!doc || !root?.append) throw new TypeError('createReleaseNotes requires a Document, ShadowRoot or element');

  const style = doc.createElement('style');
  style.dataset.releaseNotesStyle = '';
  style.textContent = RELEASE_NOTES_CSS;
  root.append(style);

  const dialog = doc.createElement('dialog');
  dialog.className = 'release-notes';
  dialog.setAttribute('aria-labelledby', 'releaseNotesTitle');
  root.append(dialog);
  let returnFocus = null;

  const readSeen = () => { try { return storage?.getItem(RELEASE_STORAGE_KEY) || ''; } catch { return ''; } };
  const markSeen = (version = CURRENT_RELEASE.version) => { try { storage?.setItem(RELEASE_STORAGE_KEY, version); } catch {} };

  function close() {
    if (dialog.open) dialog.close();
  }

  function render() {
    dialog.replaceChildren();
    const header = doc.createElement('header');
    header.className = 'release-notes__header';
    const heading = doc.createElement('div');
    heading.className = 'release-notes__heading';
    const title = doc.createElement('h2');
    title.id = 'releaseNotesTitle';
    title.textContent = t('release.title');
    const intro = doc.createElement('p');
    intro.className = 'release-notes__intro';
    intro.textContent = t('release.intro');
    heading.append(title, intro);
    const closeButton = doc.createElement('button');
    closeButton.className = 'release-notes__close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', t('release.close'));
    closeButton.textContent = '×';
    closeButton.addEventListener('click', close);
    header.append(heading, closeButton);

    const body = doc.createElement('div');
    body.className = 'release-notes__body';
    const badge = doc.createElement('span');
    badge.className = 'release-latest';
    badge.textContent = t('release.latest');
    const latest = releaseArticle(doc, CURRENT_RELEASE, true);
    latest.prepend(badge);
    body.append(latest);
    for (const release of RELEASES.slice(1)) {
      const details = doc.createElement('details');
      details.className = 'release-older';
      const summary = doc.createElement('summary');
      summary.textContent = `HomeTwin ${release.version} · ${translated(release.title)}`;
      details.append(summary, releaseArticle(doc, release, false));
      body.append(details);
    }
    dialog.append(header, body);
    return closeButton;
  }

  function open(trigger = null, { remember = false } = {}) {
    if (dialog.open) return false;
    returnFocus = trigger || root.activeElement || doc.activeElement;
    const closeButton = render();
    onOpen?.();
    dialog.showModal();
    if (remember) markSeen();
    queueMicrotask(() => closeButton.focus());
    return true;
  }

  function maybeShow({ enabled = true } = {}) {
    if (!enabled || !shouldShowReleaseNotes(CURRENT_RELEASE.version, readSeen())) return false;
    return open(null, { remember: true });
  }

  dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
  for (const type of ['keydown', 'keyup']) dialog.addEventListener(type, (event) => event.stopPropagation());
  dialog.addEventListener('close', () => {
    onClose?.();
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
    returnFocus = null;
  });

  return {
    dialog,
    open,
    close,
    maybeShow,
    hasUnseen: () => shouldShowReleaseNotes(CURRENT_RELEASE.version, readSeen()),
    markSeen,
    destroy() { close(); dialog.remove(); style.remove(); }
  };
}
