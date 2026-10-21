import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CSS } from '../frontend/src/styles.js';

const browser=await chromium.launch();
try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});
    await page.setContent('<style>body{margin:0}partial-panel-resolver{display:inline;height:auto}</style><partial-panel-resolver><ha-panel-custom><height-test></height-test></ha-panel-custom></partial-panel-resolver>');
    await page.evaluate(css=>{const host=document.querySelector('height-test');host.attachShadow({mode:'open'}).innerHTML=`<style>${css}</style><canvas class="stage"></canvas>`;},CSS);
    const rect=await page.locator('height-test').boundingBox();
    assert.equal(rect.height,viewport.height,'inline HA resolver must not collapse the panel');
    assert.equal((await page.locator('height-test canvas').boundingBox()).height,viewport.height);
    await page.close();
  }
  console.log('PASS issue #12 inline resolver: desktop/mobile panel and canvas height');
} finally {await browser.close();}
