export const CSS = `
:host { display: block; position: relative; height: 100%; width: 100%; overflow: hidden;
  --stage: #0b0f17; --panel: rgba(20, 26, 38, 0.88); --panel-solid: #141a26; --line: #273042; --line-soft: #1d2433;
  --fg: #e7ebf2; --muted: #8d97ab; --lamp: #ffb35c; --lamp-soft: rgba(255,179,92,.14); --edit: #79a6ff; --edit-soft: rgba(121,166,255,.14);
  --heat: #ff7a45; --ok: #5fd39a; --warn: #ff6b6b;
  --f-ui: var(--ha-font-family-body, "Hanken Grotesk", Roboto, system-ui, -apple-system, "Segoe UI", sans-serif);
  --f-num: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  background: var(--stage); color: var(--fg); font-family: var(--f-ui); font-size: 14px; color-scheme: dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
button, input, select, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--edit); outline-offset: 2px; }
canvas.stage { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.labels { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.rlabel { position: absolute; transform: translate(-50%, -50%); text-align: center; white-space: nowrap; text-shadow: 0 1px 6px rgba(0,0,0,.85); }
.rlabel b { display: block; font-size: 12px; font-weight: 600; }
.rlabel span { font-family: var(--f-num); font-size: 11px; color: var(--muted); }
.rlabel .on { color: var(--lamp); }
.rlabel.out b { font-weight: 500; color: #b9c4a8; }
.rlabel.lvl b { font-size: 15px; font-weight: 700; } .rlabel.lvl { text-align: left; transform: none; }
.dim { position: absolute; left: 0; top: 0; pointer-events: auto; white-space: nowrap; background: var(--panel-solid); border: 1px solid var(--edit); color: var(--fg); font-family: var(--f-num); font-size: 11.5px; padding: 1px 6px; border-radius: 6px; cursor: text; }
.dim:hover { background: var(--edit); color: #0b1222; }
.dim.ghost { pointer-events: none; border-color: var(--lamp); color: var(--lamp); cursor: default; }
.dim.ghost:hover { background: var(--panel-solid); color: var(--lamp); }
.dim input { width: 64px; background: none; border: 0; outline: none; color: inherit; font: inherit; padding: 0; }
.dim.editing { background: var(--panel-solid); color: var(--fg); }
.tip { position: absolute; pointer-events: none; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; font-size: 12px; z-index: 30; }
.tip small { display: block; color: var(--muted); font-family: var(--f-num); font-size: 11px; }

.topbar { position: absolute; top: 0; left: 0; right: 0; z-index: 20; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px 16px; pointer-events: none; }
.topbar > * { pointer-events: auto; }
.brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.brand strong { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
.brand span { color: var(--muted); font-size: 13px; white-space: nowrap; }
.spacer { flex: 1; }
.seg { display: inline-flex; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 3px; backdrop-filter: blur(12px); }
.seg button { border: 0; background: none; padding: 6px 12px; border-radius: 999px; color: var(--muted); font-weight: 600; font-size: 13px; display: inline-flex; gap: 6px; align-items: center; white-space: nowrap; }
.seg button[aria-pressed="true"] { background: var(--fg); color: var(--stage); }
:host([mode="edit"]) .seg.mode button[aria-pressed="true"] { background: var(--edit); }
.ibtn { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); backdrop-filter: blur(12px); color: var(--fg); flex: none; }
.ibtn[aria-pressed="true"] { border-color: var(--lamp); color: var(--lamp); }
:host([mode="edit"]) .ibtn[aria-pressed="true"] { border-color: var(--edit); color: var(--edit); }
.ibtn:disabled { opacity: .4; cursor: default; }
svg { width: 17px; height: 17px; flex: none; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--line-soft); font-weight: 600; font-size: 13px; }
.btn.primary { background: var(--edit); border-color: var(--edit); color: #0b1222; }
.btn.danger { color: var(--warn); }
.btn.small { padding: 5px 9px; font-size: 12px; }
.btn:disabled { opacity: .5; cursor: default; }
.savestate { font-size: 12px; color: var(--muted); font-family: var(--f-num); }
:host([mode="view"]) .edit-only, :host([mode="edit"]) .view-only { display: none !important; }

.panel { position: absolute; z-index: 10; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; backdrop-filter: blur(16px); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.panel-head { padding: 14px 16px 10px; display: flex; align-items: center; gap: 8px; }
.panel-head h2 { margin: 0; font-size: 12.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.panel-body { overflow-y: auto; padding: 0 12px 14px; min-height: 0; flex: 1; }
.vp { top: 64px; right: 16px; bottom: 16px; width: 348px; }
.lib { top: 64px; left: 16px; bottom: 16px; width: 300px; }
.insp { top: 64px; right: 16px; width: 304px; max-height: calc(100% - 80px); }
.agent { right: 16px; bottom: 16px; width: 380px; height: min(520px, calc(100% - 96px)); z-index: 12; }
.popover { top: 60px; right: 16px; width: 300px; z-index: 25; padding: 14px; gap: 12px; }

.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px; padding: 0 12px 12px; }
.stat { background: var(--line-soft); border-radius: 10px; padding: 9px 10px; }
.stat b { display: block; font-family: var(--f-num); font-size: 17px; font-weight: 500; font-variant-numeric: tabular-nums; }
.stat span { font-size: 11px; color: var(--muted); letter-spacing: .04em; text-transform: uppercase; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 12px 10px; }
.chip { border: 1px solid var(--line); background: none; border-radius: 999px; padding: 5px 11px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.chip[aria-pressed="true"] { color: var(--fg); border-color: var(--fg); }
.chip.scene { color: var(--fg); }
.chip.scene:hover { border-color: var(--lamp); color: var(--lamp); }
.room-group h3 { font-size: 12px; font-weight: 700; margin: 14px 4px 8px; color: var(--muted); letter-spacing: .06em; text-transform: uppercase; display: flex; justify-content: space-between; gap: 8px; }
.room-group h3 span { font-family: var(--f-num); letter-spacing: 0; text-transform: none; font-weight: 400; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tile { position: relative; text-align: left; border: 1px solid var(--line-soft); background: var(--line-soft); border-radius: 12px; padding: 10px 10px 9px; min-height: 76px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.tile .ic { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: rgba(255,255,255,.05); color: var(--muted); }
.tile .nm { font-weight: 600; font-size: 13px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile .st { font-family: var(--f-num); font-size: 11.5px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile.on { background: var(--lamp-soft); border-color: rgba(255,179,92,.35); }
.tile.on .ic { background: var(--lamp); color: #2b1b06; }
.tile.heat.on { background: rgba(255,122,69,.13); border-color: rgba(255,122,69,.35); }
.tile.heat.on .ic { background: var(--heat); }
.tile.alert { border-color: rgba(255,107,107,.45); }
.tile.alert .ic { background: var(--warn); color: #2a0808; }
.tile .more { position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; border-radius: 7px; color: var(--muted); display: grid; place-items: center; }
.tile .more:hover { background: rgba(255,255,255,.07); }
.tile .bar { position: absolute; left: 10px; right: 10px; bottom: 5px; height: 2px; border-radius: 2px; background: rgba(255,255,255,.06); overflow: hidden; }
.tile .bar i { display: block; height: 100%; background: var(--lamp); }
.hint { color: var(--muted); font-size: 12.5px; line-height: 1.45; padding: 4px 4px 0; margin: 0; }
.detail { padding: 4px 4px 0; display: flex; flex-direction: column; gap: 14px; }
.detail h3 { margin: 0; font-size: 18px; }
.eid { font-family: var(--f-num); font-size: 11.5px; color: var(--muted); }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field label, .field .lbl { font-size: 11.5px; color: var(--muted); letter-spacing: .05em; text-transform: uppercase; display: flex; justify-content: space-between; gap: 6px; }
.field output { font-family: var(--f-num); text-transform: none; letter-spacing: 0; color: var(--fg); }
input[type="range"] { width: 100%; accent-color: var(--lamp); }
:host([mode="edit"]) input[type="range"] { accent-color: var(--edit); }
.swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.stylegrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.stylegrid .btn { justify-content: center; }
.stylegrid .btn[aria-pressed="true"], .heads button[aria-pressed="true"] { background: var(--edit-soft); color: var(--fg); border-color: var(--edit); }
.heads { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.heads button { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; border: 1px solid var(--line); border-radius: 8px; background: var(--line-soft); color: var(--fg); font: inherit; cursor: pointer; }
.heads button svg { width: 100%; height: 22px; }
.heads button small { font-size: 9.5px; line-height: 1.15; text-align: center; opacity: .85; }
.chks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; margin: 6px 0 10px; }
.chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; cursor: pointer; }
.swatches button { width: 30px; height: 30px; border-radius: 50%; border: 2px solid transparent; }
.swatches button[aria-pressed="true"] { border-color: var(--fg); }
.big-temp { display: flex; align-items: center; justify-content: space-between; background: var(--line-soft); border-radius: 12px; padding: 10px; }
.big-temp b { font-family: var(--f-num); font-size: 30px; font-weight: 500; }
.camimg { width: 100%; border-radius: 10px; background: #000; aspect-ratio: 16/9; object-fit: cover; }

.tabs { display: flex; gap: 4px; padding: 0 12px 10px; }
.tabs button { flex: 1; border: 0; background: var(--line-soft); padding: 7px 2px; border-radius: 8px; color: var(--muted); font-weight: 600; font-size: 12px; }
.tabs button[aria-pressed="true"] { background: var(--edit-soft); color: var(--edit); }
.cat { font-size: 11.5px; color: var(--muted); letter-spacing: .07em; text-transform: uppercase; margin: 14px 4px 8px; }
.assets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.asset { overflow-wrap: anywhere; font-size: 11px !important; border: 1px solid var(--line-soft); background: var(--line-soft); border-radius: 10px; padding: 4px 4px 7px; display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11.5px; font-weight: 600; line-height: 1.15; text-align: center; min-width: 0; }
.asset:hover { border-color: var(--edit); }
.asset img, .asset .ph { width: 100%; aspect-ratio: 1; max-width: 100%; object-fit: contain; }
.asset .ph { display: grid; place-items: center; color: var(--muted); }
.fsel { width: 100%; min-width: 0; background: var(--line-soft); border: 1px solid var(--line); border-radius: 8px; padding: 6px 6px; font-size: 12.5px; }
.search { display: flex; align-items: center; gap: 6px; background: var(--line-soft); border: 1px solid var(--line); border-radius: 9px; padding: 0 8px; margin: 0 0 4px; }
.search input { flex: 1; min-width: 0; background: none; border: 0; padding: 7px 0; outline: none; }
.listrow { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 9px; border: 1px solid transparent; width: 100%; background: none; text-align: left; }
.listrow:hover { background: var(--line-soft); }
.listrow[aria-pressed="true"] { border-color: var(--edit); background: var(--edit-soft); }
.listrow .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.listrow small { font-family: var(--f-num); color: var(--muted); font-size: 11px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.ok { background: var(--ok); } .dot.no { background: var(--warn); }
.kbd { font-family: var(--f-num); font-size: 11px; border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
.form { display: flex; flex-direction: column; gap: 12px; padding: 0 16px 16px; overflow-y: auto; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.form input[type="number"], .form input[type="text"], .form input[type="date"], .form select, .popover input[type="date"], .popover select { width: 100%; background: var(--line-soft); border: 1px solid var(--line); border-radius: 8px; padding: 7px 8px; min-width: 0; }
.form input[type="color"] { width: 100%; height: 34px; background: none; border: 1px solid var(--line); border-radius: 8px; padding: 2px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.kind { display: flex; gap: 10px; align-items: center; }
.kind img { width: 52px; height: 52px; background: var(--line-soft); border-radius: 10px; }
.kind b { font-size: 16px; display: block; }
.kind small { color: var(--muted); }
.badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px; background: var(--edit-soft); color: var(--edit); }
.badge.no { background: rgba(255,107,107,.13); color: var(--warn); }
.tools { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.tool { border: 1px solid var(--line-soft); background: var(--line-soft); border-radius: 10px; padding: 8px 4px; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; }
.tool[aria-pressed="true"] { border-color: var(--edit); color: var(--edit); background: var(--edit-soft); }
.toolhint { position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 15; background: var(--panel-solid); border: 1px solid var(--edit); color: var(--fg); border-radius: 999px; padding: 7px 14px; font-size: 12.5px; max-width: calc(100% - 32px); text-align: center; }
.edbar { position: absolute; top: 64px; left: 50%; transform: translateX(-50%); z-index: 15; display: flex; align-items: center; gap: 4px; padding: 5px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; backdrop-filter: blur(14px); max-width: calc(100% - 660px); flex-wrap: wrap; justify-content: center; }
.edbar .tb { width: 34px; height: 34px; border: 0; background: none; }
.edbar .tb[aria-pressed="true"] { background: var(--edit-soft); color: var(--edit); }
.edbar .tb:hover:not(:disabled) { background: var(--line-soft); }
.edbar .sep { width: 1px; height: 22px; background: var(--line); margin: 0 3px; }
.edbar .seg { background: var(--line-soft); }
.edstatus { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 15; display: flex; gap: 14px; align-items: center; padding: 6px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; backdrop-filter: blur(14px); font-size: 12.5px; color: var(--muted); white-space: nowrap; max-width: calc(100% - 660px); overflow: hidden; }
.edstatus b { color: var(--fg); }
.edstatus .check { font-size: 12.5px; }
.tree { display: flex; flex-direction: column; margin-top: 6px; }
.trow { display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px calc(4px + var(--d) * 14px); border-radius: 7px; cursor: pointer; min-height: 30px; }
.trow:hover { background: var(--line-soft); }
.trow.sel { background: var(--edit-soft); color: var(--edit); }
.trow .chev { width: 18px; flex: none; border: 0; background: none; color: var(--muted); padding: 0; font-size: 11px; text-align: center; }
.trow .tic { color: var(--muted); display: grid; place-items: center; }
.trow .tic svg { width: 15px; height: 15px; }
.trow.sel .tic { color: var(--edit); }
.trow .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.trow small { font-family: var(--f-num); color: var(--muted); font-size: 10.5px; white-space: nowrap; }
.trow .tbtn { width: 22px; height: 22px; border: 0; background: none; color: var(--muted); display: grid; place-items: center; border-radius: 5px; opacity: 0; padding: 0; }
.trow .tbtn svg { width: 14px; height: 14px; }
.trow:hover .tbtn, .trow .tbtn.on { opacity: 1; }
.trow .tbtn.on { color: var(--lamp); }
details.sec { border-top: 1px solid var(--line-soft); padding: 8px 0 2px; }
details.sec > summary { cursor: pointer; list-style: none; font-size: 11.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); padding: 2px 0 8px; display: flex; justify-content: space-between; }
details.sec > summary::after { content: '▾'; font-size: 10px; }
details.sec:not([open]) > summary::after { content: '▸'; }
details.sec > summary::-webkit-details-marker { display: none; }
.secb { display: flex; flex-direction: column; gap: 10px; padding-bottom: 8px; }
.check { display: flex; gap: 8px; align-items: center; font-size: 13px; }

.msgs { flex: 1; overflow-y: auto; padding: 0 14px; display: flex; flex-direction: column; gap: 10px; }
.msg { max-width: 92%; padding: 9px 11px; border-radius: 12px; line-height: 1.45; font-size: 13px; white-space: pre-wrap; }
.msg.bot { background: var(--line-soft); align-self: flex-start; }
.msg.me { background: var(--edit-soft); align-self: flex-end; }
.msg.err { background: rgba(255,107,107,.12); }
.ops { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; white-space: normal; }
.ops label { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; }
.ops code, .msg code { font-family: var(--f-num); font-size: 11px; }
.composer { display: flex; gap: 6px; padding: 10px 12px 12px; border-top: 1px solid var(--line-soft); flex-wrap: wrap; }
.composer input[type="text"] { flex: 1; min-width: 0; background: var(--line-soft); border: 1px solid var(--line); border-radius: 9px; padding: 8px 10px; }
.composer .check { flex-basis: 100%; font-size: 12px; color: var(--muted); }
.model { font-family: var(--f-num); font-size: 11px; color: var(--muted); margin-left: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
.modal { position: absolute; inset: 0; z-index: 40; background: rgba(5,8,14,.6); display: grid; place-items: center; padding: 16px; }
.modal .card { width: min(680px, 100%); max-height: 86%; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
.modal textarea { flex: 1; min-height: 300px; background: #0d121c; border: 0; border-top: 1px solid var(--line); padding: 12px; font-family: var(--f-num); font-size: 12px; resize: none; }
.modal .foot { display: flex; gap: 8px; padding: 12px; justify-content: flex-end; }
.toast { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--fg); color: var(--stage); padding: 8px 14px; border-radius: 999px; font-weight: 600; z-index: 50; font-size: 13px; }
.sunline { font-family: var(--f-num); font-size: 12px; color: var(--muted); }

.brand .logo { display: inline-flex; width: 26px; height: 26px; margin-right: 8px; vertical-align: middle; } .brand .logo svg { width: 100%; height: 100%; } .brand { display: inline-flex; align-items: center; }
.sceneprev { position: absolute; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 23; display: flex; gap: 10px; align-items: center; background: var(--panel); border: 1px solid rgba(255,179,92,.5); border-radius: 14px; padding: 8px 10px 8px 14px; backdrop-filter: blur(12px); box-shadow: 0 10px 40px rgba(0,0,0,.4); max-width: calc(100% - 32px); flex-wrap: wrap; }
@media (max-width: 820px) { .sceneprev { bottom: calc(46% + 16px); } }
.stats { position: absolute; left: 16px; bottom: 16px; z-index: 22; font: 500 12px/1.4 ui-monospace, monospace; color: #cfe0ff; background: rgba(11,15,23,.82); border: 1px solid var(--line); border-radius: 10px; padding: 6px 10px; pointer-events: none; }
.walkhud { position: absolute; left: 50%; top: 64px; transform: translateX(-50%); z-index: 21; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 8px 12px; backdrop-filter: blur(12px); display: flex; flex-direction: column; gap: 4px; max-width: calc(100% - 32px); }
.walkhud .wh-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; } .walkhud .wh-lvl { color: var(--muted); font-size: 13px; }
.walkhud .wh-body { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); } .walkhud .wh-body input { width: 64px; }
.walkhud .wh-hint { font-size: 12px; color: var(--muted); }
.joy { position: absolute; left: 24px; bottom: 120px; z-index: 22; width: 120px; height: 120px; border-radius: 50%; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.25); backdrop-filter: blur(8px); display: grid; place-items: center; touch-action: none; }
.joy i { width: 52px; height: 52px; border-radius: 50%; background: rgba(255,255,255,.55); box-shadow: 0 4px 16px rgba(0,0,0,.35); pointer-events: none; }
@media (max-width: 820px) { .walkhud { top: 118px; } .joy { bottom: calc(104px + 24px); } }
.roomsel { position: relative; display: inline-flex; } .roomsel .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.roomsel select { appearance: none; -webkit-appearance: none; background: var(--panel) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23aab3c5' stroke-width='1.6' fill='none'/%3E%3C/svg%3E") no-repeat right 12px center; border: 1px solid var(--line); border-radius: 999px; color: var(--fg); font: 600 13px/1 inherit; font-family: inherit; padding: 10px 32px 10px 14px; min-height: 38px; max-width: 46vw; backdrop-filter: blur(12px); cursor: pointer; }
.roomsel select option, .roomsel select optgroup { background: var(--panel-solid); color: var(--fg); }
.sheet-grip { display: none; }
@media (max-width: 820px) {
  .vp { transition: height .25s ease, max-height .25s ease; }
  .vp[data-sheet="peek"] { height: 104px; max-height: 104px; } .vp[data-sheet="peek"] > :not(.sheet-grip):not(.panel-head) { display: none !important; }
  .vp[data-sheet="full"] { height: calc(100% - 128px); max-height: calc(100% - 128px); }
  .sheet-grip { display: flex; justify-content: center; align-items: center; width: 100%; height: 22px; border: 0; background: none; padding: 0; cursor: grab; touch-action: none; flex: none; }
  .sheet-grip i { width: 42px; height: 5px; border-radius: 3px; background: var(--muted); opacity: .6; }
  .seg button { min-height: 32px; } .chip { min-height: 36px; }
  .roomsel select { max-width: 40vw; }
}
@media (max-width: 1100px) { .edstatus { display: none; } .edbar { top: auto; bottom: 16px; max-width: calc(100% - 32px); } }
@media (max-width: 820px) {
  .edbar { bottom: calc(46% + 16px); }
  .brand span, .wide { display: none !important; }
  .vp, .lib, .insp, .agent { top: auto; left: 8px; right: 8px; width: auto; bottom: 8px; height: 46%; max-height: 46%; }
  .insp, .agent { z-index: 13; }
  .assets { grid-template-columns: repeat(4, 1fr); }
  .popover { left: 8px; right: 8px; width: auto; }
}

/* ---------- floor-plan wizard ---------- */
.wzwrap { position: absolute; inset: 0; z-index: 45; background: rgba(5,8,14,.72); display: grid; place-items: center; padding: 18px; }
.wz { width: min(1240px, 100%); height: min(820px, 100%); background: var(--panel-solid); border: 1px solid var(--line); border-radius: 18px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,.5); }
.wz-head { display: flex; align-items: center; gap: 16px; padding: 12px 14px 12px 18px; border-bottom: 1px solid var(--line); }
.wz-head h2 { display: flex; align-items: center; gap: 8px; font-size: 16px; margin: 0; white-space: nowrap; } .wz-head h2 svg { width: 18px; height: 18px; color: var(--edit); }
.wz-steps { display: flex; gap: 4px; list-style: none; margin: 0 auto; padding: 0; flex-wrap: wrap; }
.wz-steps li { display: flex; align-items: center; gap: 7px; padding: 5px 11px 5px 6px; border-radius: 999px; font-size: 13px; color: var(--muted); }
.wz-steps li span { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line); font-size: 12px; font-weight: 600; }
.wz-steps li.cur { background: var(--edit-soft); color: var(--fg); } .wz-steps li.cur span { background: var(--edit); border-color: var(--edit); color: #0b0f17; }
.wz-steps li.done span { background: var(--line-soft); color: var(--ok); }
.wz-body { flex: 1; min-height: 0; display: flex; }
.wz-two { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 330px; min-height: 0; }
.wz-side { border-left: 1px solid var(--line); padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.wz-side h3, .wz-center h3 { margin: 0; font-size: 15px; display: flex; gap: 8px; align-items: center; }
.wz-side .hint { margin: 0; }
.wz-side fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.wz-side textarea { width: 100%; background: #0d121c; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; color: var(--fg); font: inherit; font-size: 13px; resize: vertical; }
.wz-side details summary { cursor: pointer; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
.wz-canvas { position: relative; min-height: 0; overflow: hidden; background: #0d121c; touch-action: none; }
.wz-canvas canvas#wzCv { position: absolute; inset: 0; display: block; }
.wz-zoom { position: absolute; right: 12px; top: 12px; display: flex; flex-direction: column; gap: 6px; }
.wz-zoom .ibtn { font-size: 18px; font-weight: 600; }
.wz-loupe { position: absolute; width: 150px; height: 150px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 6px 20px rgba(0,0,0,.5); pointer-events: none; z-index: 2; }
.wz-stephint { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 7px 16px; font-size: 13px; backdrop-filter: blur(10px); pointer-events: none; white-space: nowrap; }
.wz-stephint.active { border-color: var(--edit); box-shadow: 0 0 0 3px var(--edit-soft); } .wz-stephint b { color: var(--edit); }
.wz-blend { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; font-size: 12px; backdrop-filter: blur(10px); }
.wz-drop { margin: 18px; border: 2px dashed var(--line); border-radius: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px; text-align: center; color: var(--muted); min-height: 0; overflow: hidden; }
.wz-drop.over { border-color: var(--edit); background: var(--edit-soft); }
.wz-drop > svg { width: 42px; height: 42px; color: var(--edit); } .wz-drop strong { color: var(--fg); font-size: 16px; }
.wz-drop img { max-width: 100%; max-height: calc(100% - 110px); object-fit: contain; border-radius: 8px; background: #fff; }
.wz-pages { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.wz-pages button { border: 1px solid var(--line); background: var(--line-soft); border-radius: 8px; padding: 4px; color: var(--fg); font-size: 11px; display: flex; flex-direction: column; gap: 3px; align-items: center; }
.wz-pages button[aria-pressed="true"] { border-color: var(--edit); background: var(--edit-soft); } .wz-pages img { width: 100%; border-radius: 4px; background: #fff; }
.wz-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--line); }
.wz-msg { margin-right: auto; font-size: 13px; color: var(--muted); } .wz-msg .err, .wz .warn { color: var(--warn); } .wz .ok { color: var(--ok); margin: 0; font-size: 13px; }
.wz .warn { margin: 0; font-size: 13px; }
.wz-center { margin: auto; max-width: 520px; padding: 30px; display: flex; flex-direction: column; gap: 14px; text-align: center; align-items: center; }
.wz-dims { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.wz-review .wz-sum { font-size: 13px; }
.wz-open { display: flex; flex-direction: column; gap: 6px; margin: 10px 0; padding-top: 10px; border-top: 1px solid var(--line, rgba(255,255,255,.08)); }
.wz-open .actions { flex-wrap: wrap; } .wz-open .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.wz-open [aria-pressed="true"] { outline: 2px solid var(--accent, #79a6ff); }
.wz-osel { display: flex; gap: 6px; align-items: center; } .wz-osel select { flex: 1; } .wz-osel input { width: 76px; }
.wz-prob { display: flex; gap: 6px; align-items: stretch; } .wz-prob > .warn { flex: 1; } .wz-probs > .btn { align-self: flex-start; }
.wz-probs { display: flex; flex-direction: column; gap: 4px; } .wz-probs button { text-align: left; background: rgba(255,92,92,.1); border: 1px solid rgba(255,92,92,.35); border-radius: 8px; padding: 6px 8px; font-size: 12px; color: var(--fg); }
.wz-rooms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow: auto; }
.wz .field input:not([type=checkbox]):not([type=radio]):not([type=range]), .wz .field select { width: 100%; background: #0d121c; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; color: var(--fg); font: inherit; font-size: 14px; }
.wz .field input:focus, .wz .field select:focus, .wz-rooms input:focus { outline: 2px solid var(--edit); outline-offset: -1px; }
.wz .field input:disabled { opacity: .5; }
.wz-rooms li { display: grid; grid-template-columns: 10px minmax(0, 1fr) 70px 50px 28px 28px; gap: 6px; align-items: center; padding: 4px 6px; border-radius: 8px; border: 1px solid transparent; }
.wz-rooms li.sel { border-color: var(--edit); background: var(--edit-soft); }
.wz-rooms li i { width: 10px; height: 10px; border-radius: 3px; } .wz-rooms li small { color: var(--muted); font-family: var(--f-num); font-size: 11px; text-align: right; }
.wz-rooms input, .wz-rooms select { min-width: 0; background: #0d121c; border: 1px solid var(--line); border-radius: 7px; padding: 4px 6px; color: var(--fg); font: inherit; font-size: 12.5px; }
.wz-rooms .ibtn { width: 28px; height: 28px; } .wz-rooms .ibtn svg { width: 14px; height: 14px; }
.wz-apply { border-top: 1px solid var(--line) !important; padding-top: 10px !important; }
.danger-zone { margin-top: 10px; } .danger-zone summary { cursor: pointer; font-size: 12px; color: var(--muted); } .danger-zone .btn { margin-top: 6px; }
.wz-tip { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--edit-soft); border: 1px solid var(--edit); font-size: 13px; line-height: 1.45; }
.wz-live { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 10px; background: var(--line-soft); }
.wz-live h3 { display: flex; } .wz-resume { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; background: var(--edit-soft); border: 1px solid var(--edit); font-size: 13px; } .wz-resume span { color: var(--muted); font-size: 12px; }
.wz-time { margin-left: auto; font-family: var(--f-num); font-size: 13px; color: var(--muted); font-weight: 500; }
.wz-progress { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.wz-progress li.done { color: var(--muted); } .wz-progress li.done::marker { content: '✓  '; color: var(--ok); }
.wz-progress li.cur { color: var(--fg); } .wz-progress li.cur::marker { content: '◌  '; color: var(--edit); }
.wz code { font-family: var(--f-num); font-size: 12px; background: var(--line-soft); padding: 1px 5px; border-radius: 5px; }
.wz-rooms small .ok, .wz-rooms small .warn { font-size: 10.5px; }
.wz-scan { position: absolute; left: 0; right: 0; height: 80px; background: linear-gradient(180deg, transparent, rgba(121,166,255,.35), transparent); animation: wzscan 2.2s linear infinite; pointer-events: none; }
@keyframes wzscan { from { top: -80px; } to { top: 100%; } }
.wz-spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--edit); animation: wzspin 0.9s linear infinite; }
@keyframes wzspin { to { transform: rotate(360deg); } }
.mobile-only { display: none; }
@media (max-width: 820px) {
  .wzwrap { padding: 0; } .wz { border-radius: 0; height: 100%; }
  .wz-steps li { font-size: 0; padding: 4px; } .wz-steps li.cur { font-size: 12px; padding-right: 10px; }
  .wz-two { grid-template-columns: 1fr; grid-template-rows: minmax(260px, 1fr) auto; } .wz-side { border-left: 0; border-top: 1px solid var(--line); max-height: 45vh; }
  .mobile-only { display: inline-flex; }
}
/* ---------- first start ---------- */
.onboard { position: absolute; inset: 0; z-index: 44; display: grid; place-items: center; padding: 18px; background: linear-gradient(180deg, rgba(5,8,14,.25), rgba(5,8,14,.75)); }
.onboard .ob { width: min(760px, 100%); background: var(--panel-solid); border: 1px solid var(--line); border-radius: 20px; padding: 26px; box-shadow: 0 30px 80px rgba(0,0,0,.5); }
.ob-languages { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.ob-languages button { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--line-soft); color: var(--fg); font: inherit; cursor: pointer; }
.ob-languages button[aria-pressed="true"], .ob-languages button:focus-visible { border-color: var(--edit); background: var(--edit-soft); }
.ob-languages img { border-radius: 2px; object-fit: cover; }
.ob-languages { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
.ob-languages button { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--line-soft); color: var(--fg); font: inherit; cursor: pointer; }
.ob-languages button[aria-pressed="true"], .ob-languages button:focus-visible { border-color: var(--edit); background: var(--edit-soft); }
.ob-languages img { border-radius: 2px; object-fit: cover; }
.onboard h2 { margin: 0 0 6px; font-size: 22px; } .onboard p.lead { margin: 0 0 18px; color: var(--muted); }
.onboard .choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.onboard .choice { text-align: left; display: flex; flex-direction: column; gap: 8px; padding: 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--line-soft); color: var(--fg); font: inherit; cursor: pointer; }
.onboard .choice:hover, .onboard .choice:focus-visible { border-color: var(--edit); background: var(--edit-soft); }
.onboard .choice svg { width: 26px; height: 26px; color: var(--edit); } .onboard .choice strong { font-size: 15px; } .onboard .choice span { font-size: 13px; color: var(--muted); }
.onboard .choice.primary { border-color: var(--edit); }
@media (max-width: 820px) { .onboard .choices { grid-template-columns: 1fr; } }
/* ---------- context menu ---------- */
.ctxmenu { position: absolute; z-index: 50; min-width: 200px; background: var(--panel-solid); border: 1px solid var(--line); border-radius: 12px; padding: 5px; box-shadow: 0 14px 40px rgba(0,0,0,.45); display: flex; flex-direction: column; }
.ctxmenu button { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border: 0; background: none; color: var(--fg); font: inherit; font-size: 13px; border-radius: 8px; text-align: left; cursor: pointer; }
.ctxmenu button:hover:not(:disabled), .ctxmenu button:focus-visible { background: var(--edit-soft); outline: none; } .ctxmenu button:disabled { opacity: .4; cursor: default; }
.ctxmenu button svg { width: 15px; height: 15px; } .ctxmenu button.danger { color: var(--warn); } .ctxmenu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; }
.ctxmenu kbd { margin-left: auto; font-size: 11px; color: var(--muted); font-family: var(--f-num); }
.tree .row.dragging { opacity: .4; } .tree .row.drop-before { box-shadow: inset 0 2px 0 var(--edit); } .tree .row.drop-after { box-shadow: inset 0 -2px 0 var(--edit); } .tree .row.drop-into { background: var(--edit-soft); outline: 1px dashed var(--edit); }
.tree .row input.rename { flex: 1; min-width: 0; background: #0d121c; border: 1px solid var(--edit); border-radius: 6px; padding: 2px 6px; color: var(--fg); font: inherit; font-size: 13px; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
