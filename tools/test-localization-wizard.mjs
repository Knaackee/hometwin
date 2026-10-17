import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.HOMETWIN_TEST_URL || 'http://127.0.0.1:4173/demo/';
const copy = {
  en: {
    source: 'Floor Plan Assistant',
    align: 'Drag the corners',
    scale: 'Length of the blue line',
    review: 'living area',
    applied: 'Applied 1 rooms',
  },
  de: {
    source: 'Bauplan-Assistent',
    align: 'Ecken ziehen',
    scale: 'Länge der blauen Strecke',
    review: 'Wohnfläche',
    applied: '1 Räume übernommen',
  },
};
const translationKey = /\b(?:assistant|data|editor|panel)\.[a-z][\w.]*/g;

mkdirSync('.preview', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

try {
  for (const language of ['en', 'de']) {
    const context = await browser.newContext({
      locale: language === 'en' ? 'de-DE' : 'en-US',
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(base + (language === 'de' ? '?lang=de' : ''));
    await page.waitForFunction(() => document.querySelector('hometwin-panel')?.plan);
    await page.evaluate(() => document.querySelector('hometwin-panel').stage.stop());

    await page.evaluate(() => {
      const app = document.querySelector('hometwin-panel');
      const originalCallWS = app.hass.callWS.bind(app.hass);
      const originalRunJob = app.wizard.runJob.bind(app.wizard);
      app.hass.callWS = async (message) => {
        if (message.type === 'hometwin/agent/info') return { configured: true, model: 'mock-vision' };
        return originalCallWS(message);
      };
      app.wizard.runJob = async (request) => {
        globalThis.__wizardRecognitionRequest = request;
        return {
          rooms: [{
            name: 'User Room Ω',
            kind: 'room',
            points: [[0, 0], [4, 0], [4, 3], [0, 3]],
            label_area: 12,
            net_area: 12,
          }],
          openings: [],
          stairs: [],
          notes: '',
        };
      };
      globalThis.__restoreLocalizationMocks = () => {
        app.hass.callWS = originalCallWS;
        app.wizard.runJob = originalRunJob;
      };
      globalThis.__localizationConsoleErrors = [];
      globalThis.__localizationOriginalConsoleError = console.error;
      console.error = (...args) => {
        globalThis.__localizationConsoleErrors.push(args.map((value) => value?.stack || String(value)).join('\n'));
        globalThis.__localizationOriginalConsoleError(...args);
      };

      app.wizard.open({ levelId: app.activeLevelId });
      app.wizard.ai = { configured: true, model: 'mock-vision' };
      app.wizard.st.levelId = app.activeLevelId;
      app.wizard.st.mode = 'add';
      app.wizard.st.keepUnderlay = false;
      const image = document.createElement('canvas');
      image.width = 800;
      image.height = 600;
      const drawing = image.getContext('2d');
      drawing.fillStyle = '#fff';
      drawing.fillRect(0, 0, image.width, image.height);
      drawing.strokeStyle = '#111';
      drawing.lineWidth = 8;
      drawing.strokeRect(80, 70, 640, 460);
      app.wizard.st.src = image;
      app.wizard.st.srcName = 'User floor plan.png';
      app.wizard.render();
    });

    const app = page.locator('hometwin-panel');
    const wizard = app.locator('#wizard');
    assert.match(await wizard.innerText(), new RegExp(copy[language].source, 'i'));

    await page.evaluate(async () => document.querySelector('hometwin-panel').wizard.next());
    assert.match(await wizard.innerText(), new RegExp(copy[language].align, 'i'));

    await page.evaluate(async () => document.querySelector('hometwin-panel').wizard.next());
    assert.match(await wizard.innerText(), new RegExp(copy[language].scale, 'i'));

    await page.evaluate(() => {
      const assistant = document.querySelector('hometwin-panel').wizard;
      assistant.st.measure = { a: [100, 100], b: [600, 100], m: '10' };
      assistant.st.opts.refine = false;
      assistant.recalc();
      assistant.render();
    });
    await page.evaluate(async () => document.querySelector('hometwin-panel').wizard.detect());
    assert.match(await wizard.innerText(), new RegExp(copy[language].review, 'i'));
    assert.equal(await page.evaluate(() => globalThis.__wizardRecognitionRequest.language), language);
    assert.equal(await page.evaluate(() => document.querySelector('hometwin-panel').wizard.st.result.rooms[0].name), 'User Room Ω');
    await page.screenshot({ path: `.preview/localization-wizard-${language}.png` });

    const beforeRooms = await page.evaluate(() => document.querySelector('hometwin-panel').activeLevel().rooms.length);
    await page.evaluate(async () => document.querySelector('hometwin-panel').wizard.apply());
    const applyErrors = await page.evaluate(() => globalThis.__localizationConsoleErrors);
    assert.match(await wizard.innerText(), new RegExp(copy[language].applied, 'i'), applyErrors.join('\n'));
    assert.equal(await page.evaluate(() => document.querySelector('hometwin-panel').activeLevel().rooms.length), beforeRooms + 1);
    assert(await page.evaluate(() => document.querySelector('hometwin-panel').activeLevel().rooms.some((room) => room.name === 'User Room Ω')));

    await page.evaluate(async () => {
      const app = document.querySelector('hometwin-panel');
      app.wizard.close();
      app.$('onboard').hidden = true;
      app.$('onboard').innerHTML = '';
      app.$('msgs').innerHTML = '';
      app.agent.info = null;
      app.agent.history = [];
      app.setMode('edit');
      const originalCallWS = app.hass.callWS.bind(app.hass);
      app.hass.callWS = async (message) => {
        if (message.type === 'hometwin/agent/info') return { configured: true, model: 'mock-chat' };
        if (message.type === 'hometwin/agent/chat') return { reply: `Mock reply ${app.lang}`, operations: [] };
        return originalCallWS(message);
      };
      await app.agent.open();
      await app.agent.send('User request Ω');
      app.hass.callWS = originalCallWS;
    });
    assert(await app.locator('#agent').isVisible());
    assert.match(await app.locator('#msgs').innerText(), new RegExp(`Mock reply ${language}`));
    await page.screenshot({ path: `.preview/localization-agent-${language}.png` });

    const visibleKeys = (await app.innerText()).match(translationKey) || [];
    assert.deepEqual(visibleKeys, [], `Visible translation keys: ${visibleKeys.join(', ')}`);
    assert.deepEqual(pageErrors, [], `Page errors in ${language}: ${pageErrors.join('\n')}`);
    assert.deepEqual(await page.evaluate(() => globalThis.__localizationConsoleErrors), [], `Console errors in ${language}`);
    await page.evaluate(() => {
      console.error = globalThis.__localizationOriginalConsoleError;
      globalThis.__restoreLocalizationMocks();
    });
    await context.close();
    console.log(`PASS ${language}: wizard source → align → scale → recognition → review → apply, agent reply, no missing keys`);
  }
} finally {
  await browser.close();
}
