/**
 * The modal's stylesheet, as a string for the shadow root.
 *
 * Everything is scoped by the shadow boundary, so the host store's CSS cannot
 * reach in and these rules cannot leak out. Colours are set explicitly rather
 * than inherited, for the same reason: `inherit` would pull the store's fonts
 * and colours across the boundary, and a store with white-on-dark buttons would
 * hand us white text on our white panel.
 */
export const STYLES = `
:host{all:initial;position:fixed;inset:0;z-index:2147483000;display:block;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d211f}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
.backdrop{position:absolute;inset:0;background:rgba(18,24,22,.55);backdrop-filter:blur(2px)}
.dialog{position:absolute;inset:0;margin:auto;width:min(960px,calc(100% - 24px));height:min(92vh,calc(100% - 24px));display:flex;flex-direction:column;background:#faf9f6;color:#1d211f;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;outline:none}
.head{display:flex;align-items:center;gap:14px;padding:14px 18px;border-bottom:1px solid #e3e0d8;background:#fff}
.head .thumb{width:84px;height:54px;flex:none;border-radius:8px;background:#f1efe9;display:grid;place-items:center;overflow:hidden}
.head .thumb svg{width:100%;height:100%}
.head h2{margin:0;font-size:1.05rem;font-weight:700;line-height:1.25}
.head .dims{margin:2px 0 0;font-size:.85rem;color:#5c635f}
.head .grow{flex:1;min-width:0}
.close{all:unset;cursor:pointer;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:#5c635f;font-size:22px;line-height:1}
.close:hover{background:#eeece5;color:#1d211f}
.close:focus-visible{outline:3px solid #7fc8b5}
.body{flex:1;overflow-y:auto;overflow-x:hidden;padding:18px;display:grid;gap:14px;align-content:start}
.scroll-x{overflow-x:auto;max-width:100%}
.eyebrow{margin:0;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#1f6f5c;font-weight:700}
.muted{color:#5c635f}
.small{font-size:.86rem}
p{margin:0}
h3{margin:0 0 6px;font-size:.98rem}
h4{margin:0 0 4px;font-size:.9rem}
strong{font-weight:700}
.he{font-size:.9em;color:#5c635f;margin-inline-start:.5em}
.card{background:#fff;border:1px solid #e3e0d8;border-radius:12px;padding:14px 16px}
.card.tone-fits{border-color:#9fd6c4;background:#f2faf7}
.card.tone-open{border-color:#d6d2c8}
.card.tone-not-found{border-color:#f0c9a5;background:#fff8f1}
.card.tone-proven{border-color:#e8a59c;background:#fff4f2}
.card.tone-ask{border-color:#1f6f5c;box-shadow:0 0 0 3px rgba(31,111,92,.12)}
.verdict-title{margin:0;font-size:1.35rem;font-weight:800;line-height:1.2}
.verdict-title.small-title{font-size:1.15rem}
.pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:.78rem;font-weight:700;white-space:nowrap}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.pill-fits{background:#dff3ea;color:#145a49}
.pill-open{background:#eeece5;color:#4b524e}
.pill-not-found{background:#fde8d2;color:#8a4a12}
.pill-proven{background:#fbdad5;color:#8f2418}
.pill-ruled{background:#f3f1ec;color:#6b726e}
.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.row.between{justify-content:space-between}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{all:unset;cursor:pointer;display:inline-flex;align-items:baseline;gap:6px;padding:6px 10px;border-radius:10px;background:#f1efe9;border:1px solid #e3e0d8;font-size:.86rem}
.chip:hover{border-color:#1f6f5c}
.chip:focus-visible{outline:3px solid #7fc8b5}
.chip .k{color:#5c635f}
.chip .v{font-weight:700}
.chip .edit{color:#1f6f5c;font-size:.8rem}
.linkish{all:unset;cursor:pointer;color:#1f6f5c;font-weight:600;font-size:.86rem;text-decoration:underline;text-underline-offset:2px}
.linkish:focus-visible{outline:3px solid #7fc8b5}
.ask-form{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:10px}
.ask-form label{font-weight:600}
.field{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1.5px solid #cfcbc1;border-radius:10px;padding:2px 10px}
.field:focus-within{border-color:#1f6f5c;box-shadow:0 0 0 3px rgba(31,111,92,.15)}
.field input{all:unset;width:5.5em;font:inherit;font-size:1.15rem;font-weight:700;text-align:right;color:#1d211f}
.field .unit{color:#5c635f;font-size:.86rem}
.btn{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:999px;font-weight:700;font-size:.92rem;white-space:nowrap}
.btn-primary{background:#1f6f5c;color:#fff}
.btn-primary:hover{background:#185846}
.btn-ghost{border:1.5px solid #cfcbc1;color:#1d211f;background:#fff}
.btn-ghost:hover{border-color:#1f6f5c;color:#1f6f5c}
.btn:focus-visible{outline:3px solid #7fc8b5;outline-offset:2px}
.btn[disabled]{opacity:.5;cursor:default}
.error{color:#8f2418;font-size:.86rem}
.or{color:#5c635f;font-size:.86rem}
table{border-collapse:collapse;width:100%;font-size:.86rem}
th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #eeece5;vertical-align:top}
th{font-weight:600;color:#5c635f;font-size:.78rem;text-transform:uppercase;letter-spacing:.04em}
tbody th{text-transform:none;letter-spacing:0;color:#1d211f;font-weight:600;font-size:.86rem}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tr.is-chosen th,tr.is-chosen td{background:#f2faf7}
tr.is-out th,tr.is-out td{color:#8a8f8c}
.ok{color:#145a49;font-weight:700}
.short{color:#8f2418;font-weight:700}
.unk{color:#8a8f8c}
.stage{position:relative;border-radius:12px;overflow:hidden;background:#e7e7e8;aspect-ratio:16/9;max-height:420px}
.stage canvas{width:100%;height:100%;display:block;touch-action:pan-y}
.stage .label{position:absolute;left:12px;top:10px;font-size:.78rem;color:#1d211f;background:rgba(255,255,255,.8);padding:3px 8px;border-radius:6px}
.stage .note{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:20px;color:#5c635f;font-size:.9rem}
.transport{display:flex;align-items:center;gap:10px;margin-top:8px}
.transport input[type=range]{flex:1;accent-color:#1f6f5c}
.stages{margin:8px 0 0;padding-left:1.3em;display:grid;gap:4px}
.stages li::marker{color:#1f6f5c;font-weight:700}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media (max-width:640px){.cols{grid-template-columns:1fr}.dialog{width:100%;height:100%;border-radius:0}.body{padding:14px}table{font-size:.8rem}th,td{padding:6px 5px}.verdict-title{font-size:1.2rem}}
.fine{font-size:.78rem;color:#5c635f;border-top:1px solid #e3e0d8;padding-top:10px;display:grid;gap:4px}
.legend dt{font-weight:700;display:inline}
.legend dd{display:inline;margin:0}
.legend div{margin:0}
.skeleton{height:120px;border-radius:12px;background:linear-gradient(90deg,#f1efe9,#faf9f6,#f1efe9);background-size:200% 100%;animation:sh 1.2s infinite}
@keyframes sh{to{background-position:-200% 0}}
.badge{display:inline-block;padding:1px 7px;border-radius:6px;font-size:.72rem;font-weight:700;background:#eeece5;color:#4b524e;vertical-align:middle}
.badge-approx{background:#fde8d2;color:#8a4a12}
.compare th:first-child{width:36%}
`;
