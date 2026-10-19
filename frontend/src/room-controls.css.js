export const ROOM_CONTROLS_CSS = `
.vp { width:360px; background:var(--panel); }
.vp .panel-head { flex:none; padding:14px 16px 12px; gap:10px; align-items:flex-start; }
.rc-heading { min-width:0; flex:1; }
#roomContext { display:block; color:var(--muted); font-size:11px; margin-bottom:5px; }
.vp #vpTitle { font-size:19px; color:var(--fg); text-transform:none; letter-spacing:0; line-height:1.25; margin:0; }
.vp .roomsel { display:block; margin:9px 0 0; }
.vp .roomsel select { width:100%; max-width:none; border-radius:8px; min-height:36px; padding:6px 30px 6px 10px; font-size:12px; }
#roomCollapse { flex:none; width:36px; height:36px; border-radius:50%; background:var(--line-soft); border:0; }
#summary { display:flex; flex-wrap:wrap; gap:5px 12px; padding:9px 0 0; font-size:11px; color:var(--muted); }
#summary:empty { display:none; }
#roomTabs { display:flex; padding:0 12px; border-bottom:1px solid var(--line); flex:none; }
#roomTabs button { flex:1; border:0; border-bottom:2px solid transparent; background:none; color:var(--muted); min-height:44px; padding:8px 4px; font-size:13px; }
#roomTabs button[aria-pressed=true] { color:var(--fg); border-bottom-color:var(--edit); }
#roomCategories { flex:none; display:flex; flex-wrap:nowrap; overflow:auto; padding:12px 12px 4px; gap:6px; scrollbar-width:thin; }
#roomCategories .chip { flex:none; font-size:11px; }
.vp #tileArea { padding:12px; overscroll-behavior:contain; }
.rc-group + .rc-group { margin-top:18px; }
.rc-group h3 { color:var(--muted); font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.08em; margin:0 0 8px 3px; }
.rc-row { padding:9px; margin-bottom:7px; border:1px solid var(--line); background:var(--line-soft); border-radius:12px; }
.rc-row.active { border-color:rgba(255,179,92,.3); background:var(--lamp-soft); }
.rc-row.unavailable { opacity:.65; }
.rc-row-main { display:flex; align-items:center; gap:8px; }
.rc-entity { border:0; padding:0; background:none; min-width:0; flex:1; display:flex; align-items:center; gap:10px; text-align:left; min-height:44px; }
.rc-entity > span:last-child { min-width:0; }
.rc-entity b { display:block; font-size:13px; font-weight:600; overflow-wrap:anywhere; line-height:1.35; }
.rc-entity small { display:block; color:var(--muted); font-size:11px; margin-top:3px; overflow-wrap:anywhere; }
.rc-icon { flex:none; width:32px; height:32px; border-radius:9px; display:grid; place-items:center; color:var(--muted); background:var(--panel); }
.active .rc-icon { color:var(--lamp); }
.rc-icon svg { width:18px; height:18px; }
.rc-toggle { flex:none; width:46px; height:44px; border:0; background:none; position:relative; }
.rc-toggle:before { content:''; position:absolute; width:36px; height:22px; left:5px; top:11px; border-radius:15px; background:var(--muted); opacity:.4; }
.rc-toggle i { position:absolute; width:16px; height:16px; left:8px; top:14px; background:var(--fg); border-radius:50%; }
.rc-toggle[aria-pressed=true]:before { background:var(--lamp); opacity:1; }
.rc-toggle[aria-pressed=true] i { transform:translateX(14px); background:var(--panel-solid); }
.rc-slider { display:flex; align-items:center; gap:10px; font-size:11px; color:var(--muted); padding:4px 3px 0; }
.rc-slider input { width:100%; min-width:0; min-height:28px; accent-color:var(--lamp); }
.rc-cover { display:flex; gap:6px; padding-top:7px; }
.rc-cover button { flex:1; background:var(--panel); border:1px solid var(--line); border-radius:7px; min-height:36px; }
.rc-note { font-size:12px; color:var(--muted); line-height:1.5; margin:0 0 12px; }
.vp[data-sheet=peek] { bottom:auto; }
.vp[data-sheet=peek] #vpList,.vp[data-sheet=peek] #vpDetail,.vp[data-sheet=peek] .roomsel { display:none!important; }
@media(max-width:820px) {
 .vp { left:8px; right:8px; bottom:max(8px,env(safe-area-inset-bottom)); top:auto; width:auto; border-radius:20px; }
 .vp .panel-head { padding:2px 14px 10px; }
 .vp[data-sheet=peek] { height:auto; max-height:155px; bottom:max(8px,env(safe-area-inset-bottom)); }
 .vp[data-sheet=half] { height:52%; max-height:52%; }
 .vp[data-sheet=full] { height:calc(100% - 128px); max-height:calc(100% - 128px); }
 .rc-toggle,.rc-cover button { min-height:44px; }
 #roomTabs button { font-size:12px; }
 #roomCategories { padding-top:8px; }
}
@media(prefers-reduced-motion:reduce) { .vp { transition:none!important; } }
`;
