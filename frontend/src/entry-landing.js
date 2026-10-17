import { HomeTwinPanel } from './panel.js';
import { createDemoHass } from './sim.js';
import { demoPlan } from './plan.js';
import { Vector3 } from 'three';

// Landing page: reuse the real renderer, picking and simulated services.
// No production panel changes and no reads/writes of a visitor's saved demo plan.
class LandingPanel extends HomeTwinPanel {
  async _init() {
    try {
      await super._init();
      const style = document.createElement('style');
      style.textContent = '.topbar,#vp,#onboard,#labels,#sunPop,#walkHud,#joy{display:none!important}';
      this.shadowRoot.append(style);
      this.timeLive = false;
      this.customTime = new Date('2026-10-17T21:00:00+02:00');
      this.setLevel(this.plan.levels.find(l => l.elevation === 0)?.id || this.plan.levels[0].id, false);
      this.updateSun();
      this.stage.controls.enableZoom = false;
      this.stage.controls.enablePan = false;
      this.stage.controls.minAzimuthAngle = -1.3;
      this.stage.controls.maxAzimuthAngle = .5;
      this.stage.controls.minPolarAngle = .45;
      this.stage.controls.maxPolarAngle = 1.1;
      const fit = () => {
        this.stage.resize();
        const pts = this.activeLevel().rooms.filter(r => ['room','garage'].includes(r.kind)).flatMap(r => r.points);
        const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
        const w = Math.max(...xs)-Math.min(...xs), d = Math.max(...zs)-Math.min(...zs);
        const target = new Vector3((Math.max(...xs)+Math.min(...xs))/2, .4, (Math.max(...zs)+Math.min(...zs))/2);
        const aspect = this.stage.persp.aspect;
        const dist = Math.max(w, d) * (this.stage.canvas.clientWidth < 700 || aspect < 1 ? 2.25 : 1.5);
        this.stage.moveCam(target, target.clone().add(new Vector3().setFromSphericalCoords(dist, .73, -.56)), true);
        this.stage.wake(true);
      };
      new ResizeObserver(fit).observe(this);
      fit();
      this.ready = true;
      document.querySelector('.loading').hidden = true;
      document.querySelectorAll('[data-scene],[data-lamp]').forEach(b => b.disabled = false);
      const initial = structuredClone(this.hass.states);
      document.querySelectorAll('[data-scene]').forEach(button => button.addEventListener('click', async () => {
        for (const [id, state] of Object.entries(initial)) if (id.startsWith('light.')) {
          await this.call('light',state.state === 'on' ? 'turn_on' : 'turn_off',{entity_id:id,...state.attributes});
        }
        await this.call('scene','turn_on',{entity_id:button.dataset.scene});
        document.querySelectorAll('[data-scene]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        document.querySelector('#sceneStatus').textContent = 'Demo home · Simulated devices · ' + button.textContent;
        this.stage.wake(true);
      }));
      document.querySelector('[data-lamp]').addEventListener('click', () => this.call('light','toggle',{entity_id:'light.wohnzimmer_stehlampe'}));
      let visible = true;
      const sync = () => visible && !document.hidden ? this.stage.start() : this.stage.stop();
      new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); },{threshold:.05}).observe(this);
      document.addEventListener('visibilitychange',sync);
      document.querySelector('#interact').addEventListener('click', () => {
        document.querySelector('.stage').classList.add('interactive');
        document.querySelector('#finish').focus();
      });
      document.querySelector('#finish').addEventListener('click', () => {
        document.querySelector('.stage').classList.remove('interactive');
        document.querySelector('#interact').focus();
      });
    } catch (error) {
      console.error(error);
      document.querySelector('.loading').textContent = 'The 3D demo could not load. Try the full demo using the link below.';
    }
  }
}
customElements.define('hometwin-landing',LandingPanel);
const el = document.createElement('hometwin-landing');
el.panel = {config:{ui_language:'en'}};
document.querySelector('#liveHouse').append(el);
const hass = createDemoHass(h => {el.hass = {...h,user:{is_admin:false}};});
const callWS = hass.callWS;
hass.callWS = msg => msg.type === 'hometwin/plan/get' ? Promise.resolve({plan:demoPlan()}) : callWS(msg);
el.hass = {...hass,user:{is_admin:false}};
