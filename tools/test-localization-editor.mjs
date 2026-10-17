import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4173/demo/';
const translationKey = /\b(?:assistant|data|editor|panel)\.[a-z][\w.]*/g;
const copy = {
  en: {
    house: ['House', 'General'], roof: ['Roof', 'Roof shape'], level: ['Level', 'Room height'],
    room: ['Room', 'Home Assistant area'], opening: ['Dimensions'], device: ['Device', 'Home Assistant entity'],
    furniture: ['Furniture', 'Dimensions'], entities: ['Entities'], entitySearch: 'Name or entity_id', context: ['Rename'],
  },
  de: {
    house: ['Haus', 'Allgemein'], roof: ['Dach', 'Dachform'], level: ['Etage', 'Raumhöhe'],
    room: ['Raum', 'Home-Assistant-Bereich'], opening: ['Breite'], device: ['Gerät', 'Home-Assistant-Entität'],
    furniture: ['Möbel', 'Breite'], entities: ['Entitäten'], entitySearch: 'Name oder entity_id', context: ['Umbenennen'],
  },
};

mkdirSync('.preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

const inspect = async (page, language, branch, selection, level = null) => {
  await page.evaluate(({ selection, level }) => {
    const app = document.querySelector('hometwin-panel');
    if (level && app.levelSel !== level) app.setLevel(level);
    app.editor.select(selection);
  }, { selection, level });
  const text = await page.locator('hometwin-panel').locator('#insp').innerText();
  for (const expected of copy[language][branch]) assert.match(text, new RegExp(expected, 'i'), `${language}/${branch}: ${text}`);
};

try {
  for (const language of ['en', 'de']) {
    const context = await browser.newContext({
      locale: language === 'en' ? 'de-DE' : 'en-US',
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

    await page.goto(base + (language === 'de' ? '?lang=de' : ''));
    await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(() => document.querySelector('hometwin-panel').stage.stop());
    const onboardingDemo = page.locator('hometwin-panel').locator('[data-ob="demo"]');
    if (await onboardingDemo.count() && await onboardingDemo.isVisible()) await onboardingDemo.click();

    const ids = await page.evaluate(() => {
      const app = document.querySelector('hometwin-panel');
      app.setMode('edit');
      const level = app.plan.levels.find((candidate) => candidate.rooms.length) || app.plan.levels[0];
      const find = (name) => app.plan.levels.flatMap((candidate) => candidate[name].map((item) => ({ id: item.id, level: candidate.id })))[0] || null;
      const room = level.rooms[0];
      room.name = 'User Room Ω';
      app.plan.name = 'User House Ω';
      app.editor.renderLeft();
      return {
        level: level.id,
        room: room?.id || null,
        opening: find('openings'),
        device: find('devices'),
        furniture: find('furniture'),
      };
    });

    assert(ids.room && ids.opening && ids.device && ids.furniture, `${language}: demo plan lacks an editor branch fixture`);
    await inspect(page, language, 'house', null, 'all');
    await inspect(page, language, 'roof', { type: 'roof', id: 'roof' }, 'roof');
    await inspect(page, language, 'level', { type: 'level', id: ids.level, level: ids.level }, ids.level);
    await inspect(page, language, 'room', { type: 'room', id: ids.room, level: ids.level }, ids.level);
    await inspect(page, language, 'opening', { type: 'opening', ...ids.opening }, ids.opening.level);
    await inspect(page, language, 'device', { type: 'device', ...ids.device }, ids.device.level);
    await inspect(page, language, 'furniture', { type: 'furniture', ...ids.furniture }, ids.furniture.level);

    const numericResult = await page.evaluate(({ id, level }) => {
      const app = document.querySelector('hometwin-panel');
      app.setLevel(level); app.editor.select({ type: 'furniture', id, level });
      const item = app.plan.levels.find((candidate) => candidate.id === level).furniture.find((candidate) => candidate.id === id);
      const input = app.$('inspBody').querySelector('#iX'); const before = item.pos[0];
      input.value = String(before + 0.25); input.dispatchEvent(new Event('change', { bubbles: true })); const changed = item.pos[0];
      const restoredInput = app.$('inspBody').querySelector('#iX');
      restoredInput.value = String(before); restoredInput.dispatchEvent(new Event('change', { bubbles: true }));
      return { before, changed, restored: item.pos[0] };
    }, ids.furniture);
    assert.equal(numericResult.changed, numericResult.before + 0.25, `${language}: numeric inspector change did not apply`);
    assert.equal(numericResult.restored, numericResult.before, `${language}: numeric inspector value did not restore`);

    await page.evaluate(() => {
      const app = document.querySelector('hometwin-panel');
      app.editor.left = 'insert'; app.editor.insertSub = 'ents'; app.editor.renderLeft();
    });
    const sidebarText = await page.locator('hometwin-panel').locator('#lbody').innerText();
    for (const expected of copy[language].entities) assert.match(sidebarText, new RegExp(expected, 'i'), `${language}/entities: ${sidebarText}`);
    assert.equal(await page.locator('hometwin-panel').locator('#entSearch').getAttribute('placeholder'), copy[language].entitySearch);

    await page.evaluate(({ room, level }) => {
      const app = document.querySelector('hometwin-panel');
      app.setLevel(level); app.editor.left = 'tree'; app.editor.renderLeft();
      const row = app.$('lbody').querySelector(`.trow[data-pick="room"][data-id="${room}"]`);
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, clientX: 260, clientY: 240, button: 2 }));
    }, { room: ids.room, level: ids.level });
    const menu = page.locator('hometwin-panel').locator('.ctxmenu');
    await menu.waitFor({ state: 'visible' });
    const menuText = await menu.innerText();
    for (const expected of copy[language].context) assert.match(menuText, new RegExp(expected, 'i'), `${language}/context: ${menuText}`);

    const result = await page.evaluate((translationPattern) => {
      const app = document.querySelector('hometwin-panel');
      const pattern = new RegExp(translationPattern, 'g');
      const values = [];
      for (const element of app.shadowRoot.querySelectorAll('*')) {
        values.push(element.textContent || '');
        for (const attribute of ['aria-label', 'title', 'placeholder']) values.push(element.getAttribute(attribute) || '');
      }
      return {
        keys: [...new Set(values.flatMap((value) => value.match(pattern) || []))],
        houseName: app.plan.name,
        roomName: app.plan.levels.flatMap((level) => level.rooms).find((room) => room.id)?.name,
      };
    }, translationKey.source);
    assert.deepEqual(result.keys, [], `${language}: visible translation keys: ${result.keys.join(', ')}`);
    assert.equal(result.houseName, 'User House Ω');
    assert.equal(await page.evaluate((room) => document.querySelector('hometwin-panel').plan.levels.flatMap((level) => level.rooms).find((item) => item.id === room)?.name, ids.room), 'User Room Ω');
    assert.deepEqual(pageErrors, [], `${language}: page errors: ${pageErrors.join('\n')}`);
    assert.deepEqual(consoleErrors, [], `${language}: console errors: ${consoleErrors.join('\n')}`);

    await page.screenshot({ path: `.preview/localization-editor-${language}.png` });
    await context.close();
    console.log(`PASS ${language}: house/roof/level/room/opening/device/furniture inspectors, numeric change, entities, context menu, names, no missing keys/errors`);
  }
} finally {
  await browser.close();
}
