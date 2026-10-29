// Intent Trail: the decisions behind agent-written pull requests, in three layers.
//   Glance — a goal strip under the PR title and chips on file headers (light DOM, best effort)
//   Brief  — the panel's default view: goal, ≤3 things to check, ground rules, the rest folded
//   Story  — the session as chapters with checkpoints and course corrections
// Everything we own lives in one shadow root; the two light-DOM anchors are optional extras.
// Records come from git notes written by the Intent Trail plugin (see shared/intent-source.js).
// main.js drives it: sync(route) on pull request and repository pages, unmount() elsewhere.
(function (root) {
  const V = root.GitHubStacks.intentView;
  const { api } = root.GitHubStacks;
  const PANEL_WIDTH = 420;
  const OPEN_KEY = 'intent-trail:open';
  const TL_PREVIEW = 3; // rules and assumptions shown per history entry before "+N more"

  const state = {
    mode: 'pr', // 'pr' on pull request pages, 'repo' elsewhere in a repo (history only)
    repoRef: null, // { owner, repo, ref, key } in repo mode
    history: null, // { loading, error, data }
    pr: null, // { owner, repo, number, key }
    data: null,
    view: null,
    error: null,
    loading: false,
    open: false,
    tab: 'brief',
    expanded: null, // item id
    othersOpen: false,
    chapterOpen: new Set(),
    checked: new Set(),
    popover: null, // { path, rect }
  };
  let host = null;
  let shadow = null;
  let lastHref = '';

  const openKey = () => (state.mode === 'repo' ? `${OPEN_KEY}:repo` : OPEN_KEY);
  const storedOpen = () => {
    try {
      return localStorage.getItem(openKey());
    } catch {
      return null;
    }
  };
  const rememberOpen = (open) => {
    try {
      localStorage.setItem(openKey(), open ? '1' : '0');
    } catch {}
  };
  const reviewer = () => document.querySelector('meta[name="user-login"]')?.content || 'local';

  // ---------- DOM helpers (text only, never innerHTML for data) ----------
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false || c === '') continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const ICONS = {
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.01"/>',
    spark: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
    person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    steer: '<path d="M3 12h13"/><path d="M12 6l6 6-6 6"/><path d="M21 4v16"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    ring: '<circle cx="12" cy="12" r="9.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    done: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M7.5 12.5l3 3 6-6.5" stroke="var(--itl-on-ok)" stroke-width="2.2"/>',
  };
  // Static markup from the table above only; never data.
  function icon(name, size = 16, label = null) {
    const span = document.createElement('span');
    span.className = 'ic';
    span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${ICONS[name]}</svg>`;
    return span;
  }

  const fmtTime = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const fmtDay = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const span = (a, b) => (fmtTime(a) === fmtTime(b) ? fmtTime(a) : `${fmtTime(a)} – ${fmtTime(b)}`);
  const plural = V.plural;

  // ---------- theme tokens (light DOM so the shadow root and anchors share them) ----------
  const PAGE_CSS = `
    html {
      --itl-bg: var(--bgColor-default, #ffffff); --itl-subtle: var(--bgColor-muted, #f6f8fa);
      --itl-fg: var(--fgColor-default, #1f2328); --itl-muted: var(--fgColor-muted, #59636e);
      --itl-border: var(--borderColor-default, #d1d9e0);
      --itl-accent: #4338ca; --itl-accent-bg: #eef0ff;
      --itl-warn-fg: #7a4a00; --itl-warn-bg: #fff4db; --itl-warn-icon: #b45309; --itl-warn-border: #f1d49b;
      --itl-ok: #1a7f4b; --itl-on-ok: #ffffff;
      --itl-human-bg: #eef1f5; --itl-human-fg: #1f2937;
      --itl-steer-bg: #f3f4ff; --itl-steer-fg: #1e1b4b;
      --itl-shadow: 0 12px 32px rgba(16,24,40,.14);
    }
    html[data-color-mode="dark"] {
      --itl-accent: #a5b4fc; --itl-accent-bg: rgba(129,140,248,.16);
      --itl-warn-fg: #f2c14e; --itl-warn-bg: rgba(187,128,9,.18); --itl-warn-icon: #e3b341; --itl-warn-border: rgba(187,128,9,.45);
      --itl-ok: #3fb950; --itl-on-ok: #0d1117;
      --itl-human-bg: rgba(110,118,129,.22); --itl-human-fg: var(--fgColor-default, #f0f6fc);
      --itl-steer-bg: rgba(129,140,248,.14); --itl-steer-fg: #c7d2fe;
      --itl-shadow: 0 12px 32px rgba(0,0,0,.5);
    }
    @media (prefers-color-scheme: dark) {
      html[data-color-mode="auto"] {
        --itl-accent: #a5b4fc; --itl-accent-bg: rgba(129,140,248,.16);
        --itl-warn-fg: #f2c14e; --itl-warn-bg: rgba(187,128,9,.18); --itl-warn-icon: #e3b341; --itl-warn-border: rgba(187,128,9,.45);
        --itl-ok: #3fb950; --itl-on-ok: #0d1117;
        --itl-human-bg: rgba(110,118,129,.22); --itl-human-fg: var(--fgColor-default, #f0f6fc);
        --itl-steer-bg: rgba(129,140,248,.14); --itl-steer-fg: #c7d2fe;
        --itl-shadow: 0 12px 32px rgba(0,0,0,.5);
      }
    }
    @media (min-width: 1100px) { html.intent-trail-open body { margin-right: ${PANEL_WIDTH}px !important; } }
    html.intent-trail-open .ghs-navigator { right: ${PANEL_WIDTH + 16}px !important; }

    [data-intent-trail] { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; color: var(--itl-fg); }
    [data-intent-trail="strip"] { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 12px; margin: 4px 0 12px;
      padding: 10px 14px; width: 100%; cursor: pointer; border: 1px solid var(--itl-border); border-radius: 10px;
      background: var(--itl-bg); font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; color: var(--itl-fg); }
    [data-intent-trail="strip"]:hover { border-color: var(--itl-accent); }
    [data-intent-trail="strip"] .itl-goal { flex: 1; min-width: 0; line-height: 1.45; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
    [data-intent-trail="strip"] .itl-pill, [data-intent-trail="chip"] { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
      padding: 2px 10px; border-radius: 999px; font-weight: 600; font-size: 12px; }
    .itl-warn { background: var(--itl-warn-bg); color: var(--itl-warn-fg); border: 1px solid var(--itl-warn-border); }
    .itl-neutral { background: var(--itl-subtle); color: var(--itl-fg); border: 1px solid var(--itl-border); font-weight: 500 !important; }
    .itl-ok { color: var(--itl-ok); background: transparent; border: 1px solid var(--itl-border); }
    .itl-muted { color: var(--itl-muted); white-space: nowrap; }
    [data-intent-trail="chip"] { margin-left: 8px; cursor: pointer; line-height: 18px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif !important; letter-spacing: normal; }
    [data-intent-trail="chip"]:hover { filter: brightness(0.97); }
    [data-intent-trail] svg { display: block; }
  `;

  // ---------- shadow styles ----------
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; color: var(--itl-fg); }
    button { font: inherit; color: inherit; cursor: pointer; }
    .ic { display: inline-flex; flex: none; }
    .ic svg { display: block; }
    code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }

    .panel { position: fixed; top: 0; right: 0; bottom: 0; width: ${PANEL_WIDTH}px; max-width: 100vw; z-index: 2147483000;
      display: flex; flex-direction: column; background: var(--itl-bg); border-left: 1px solid var(--itl-border); box-shadow: -4px 0 16px rgba(16,24,40,.06); }
    header { display: flex; align-items: center; gap: 10px; padding: 12px 14px 12px 18px; border-bottom: 1px solid var(--itl-border); }
    header .name { font-weight: 600; font-size: 14px; flex: 1; }
    .accent { color: var(--itl-accent); }
    .seg { display: inline-flex; background: var(--itl-subtle); border-radius: 8px; padding: 3px; gap: 2px; }
    .seg button { border: 0; background: transparent; color: var(--itl-muted); font-size: 13px; padding: 4px 12px; border-radius: 6px; min-height: 30px; }
    .seg button[aria-selected="true"] { background: var(--itl-bg); color: var(--itl-fg); font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,40,.1); }
    .icon-btn { border: 0; background: transparent; width: 32px; height: 32px; border-radius: 6px; color: var(--itl-muted); display: inline-flex; align-items: center; justify-content: center; }
    .icon-btn:hover { background: var(--itl-subtle); color: var(--itl-fg); }
    .body { flex: 1; overflow-y: auto; padding: 18px 18px 32px; display: flex; flex-direction: column; gap: 22px; }

    .eyebrow { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--itl-muted); }
    .goal { margin: 6px 0 8px; font-size: 16px; line-height: 1.45; font-weight: 600; }
    .meta { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--itl-muted); flex-wrap: wrap; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
    .note { font-size: 12px; color: var(--itl-muted); }

    .sec-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
    .sec-head h2 { margin: 0; font-size: 14px; font-weight: 600; flex: 1; }
    .sec-head span { font-size: 12px; color: var(--itl-muted); }
    .progress { height: 4px; background: var(--itl-subtle); border-radius: 2px; overflow: hidden; margin: -4px 0 10px; }
    .progress > div { height: 4px; background: var(--itl-ok); border-radius: 2px; transition: width .2s ease; }

    .list { border: 1px solid var(--itl-border); border-radius: 10px; overflow: hidden; }
    .row + .row { border-top: 1px solid var(--itl-border); }
    .row.open { background: var(--itl-subtle); }
    .row-top { display: flex; align-items: flex-start; gap: 10px; padding: 12px 8px 12px 14px; }
    .row-top > .ic { padding-top: 2px; }
    .row-main { all: unset; cursor: pointer; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .row-main:focus-visible { outline: 2px solid var(--itl-accent); outline-offset: 2px; border-radius: 4px; }
    .kind { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
    .kind.assumption, .warn-ic { color: var(--itl-warn-icon); }
    .kind.assumption { color: var(--itl-warn-fg); }
    .kind.agent, .agent-ic { color: var(--itl-accent); }
    .kind.human, .human-ic { color: var(--itl-muted); }
    .title { font-size: 14px; font-weight: 600; line-height: 1.35; }
    .row.checked .title { color: var(--itl-muted); }
    .why { font-size: 13px; line-height: 1.45; color: var(--itl-muted); }
    .check { border: 0; background: transparent; width: 36px; height: 36px; margin-top: -6px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; color: var(--itl-muted); flex: none; }
    .check:hover { background: var(--itl-subtle); }
    .check.on { color: var(--itl-ok); }
    .detail { padding: 0 14px 14px 40px; display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
    .detail .rej { color: var(--itl-muted); }
    .detail .rej strong { color: var(--itl-fg); font-weight: 600; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .file { border: 1px solid var(--itl-border); background: var(--itl-bg); border-radius: 6px; padding: 1px 8px; color: var(--itl-fg); }
    .file:hover { border-color: var(--itl-accent); color: var(--itl-accent); }
    .file.out { text-decoration: line-through; opacity: .7; }
    .tag { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--itl-border); color: var(--itl-muted); }
    .tag.out { border-color: var(--itl-warn-border); color: var(--itl-warn-fg); }
    .from { font-size: 12px; color: var(--itl-muted); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn { border: 1px solid var(--itl-border); background: var(--itl-bg); color: var(--itl-fg); font-size: 13px; font-weight: 500; padding: 0 12px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { border-color: var(--itl-accent); color: var(--itl-accent); }
    .btn.primary { background: var(--itl-ok); border-color: var(--itl-ok); color: var(--itl-on-ok); font-weight: 600; }
    .btn.primary:hover { filter: brightness(1.05); color: var(--itl-on-ok); }
    .empty-row { padding: 14px; color: var(--itl-muted); font-size: 13px; }

    .rules { display: flex; flex-wrap: wrap; gap: 6px; }
    .rule { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; background: var(--itl-human-bg); color: var(--itl-human-fg); padding: 5px 10px; border-radius: 999px; }

    .fold { all: unset; cursor: pointer; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background: var(--itl-subtle); font-size: 13px; }
    .fold:focus-visible { outline: 2px solid var(--itl-accent); }
    .fold .grow { flex: 1; }
    .fold .ic.chev { color: var(--itl-muted); transition: transform .15s ease; }
    .fold[aria-expanded="true"] .ic.chev { transform: rotate(90deg); }
    .compact { margin-top: 8px; }
    .compact .row-top { padding: 9px 8px 9px 12px; }
    .compact .title { font-size: 13px; font-weight: 500; }
    .link { all: unset; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--itl-accent); }
    .link:focus-visible { outline: 2px solid var(--itl-accent); }

    .story-head h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .timeline { list-style: none; margin: 0; padding: 0; }
    .ch { display: flex; gap: 14px; }
    .rail { width: 24px; flex: none; display: flex; flex-direction: column; align-items: center; }
    .num { width: 24px; height: 24px; border-radius: 50%; background: var(--itl-fg); color: var(--itl-bg); font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex: none; }
    .line { width: 2px; flex: 1; background: var(--itl-border); margin: 4px 0; }
    .ch-body { flex: 1; min-width: 0; padding-bottom: 22px; display: flex; flex-direction: column; gap: 10px; }
    .ch-title { display: flex; align-items: baseline; gap: 8px; }
    .ch-title h3 { margin: 0; font-size: 14px; font-weight: 600; flex: 1; }
    .ch-title span { font-size: 12px; color: var(--itl-muted); white-space: nowrap; }
    .ch-sum { margin: 2px 0 0; font-size: 13px; line-height: 1.5; }
    .steer { display: flex; gap: 10px; padding: 10px 12px; background: var(--itl-steer-bg); color: var(--itl-steer-fg); border-radius: 8px; font-size: 13px; line-height: 1.45; }
    .steer .ic { margin-top: 2px; }
    .cps { display: flex; flex-direction: column; gap: 4px; }
    .cp { display: flex; align-items: center; gap: 8px; font-size: 13px; }
    .cp .ic { color: var(--itl-ok); }
    .pills { all: unset; box-sizing: border-box; width: 100%; cursor: pointer; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .pills:focus-visible { outline: 2px solid var(--itl-accent); border-radius: 6px; }
    .pill { font-size: 12px; font-weight: 500; line-height: 18px; padding: 1px 9px; border-radius: 999px; white-space: nowrap; flex: none; }
    .pill.human { background: var(--itl-human-bg); color: var(--itl-human-fg); }
    .pill.agent { background: var(--itl-accent-bg); color: var(--itl-accent); }
    .pill.warn { background: var(--itl-warn-bg); color: var(--itl-warn-fg); }
    .pills .more { font-size: 12px; color: var(--itl-accent); white-space: nowrap; margin-left: 2px; }
    .end { display: flex; gap: 14px; align-items: center; }
    .end .ring { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--itl-ok); margin: 0 6px; }
    .end span { font-size: 13px; font-weight: 600; color: var(--itl-ok); }
    .privacy { font-size: 12px; line-height: 1.5; color: var(--itl-muted); padding-top: 10px; border-top: 1px solid var(--itl-border); }

    .tl { list-style: none; margin: 0; padding: 0; }
    .tl-e { display: flex; gap: 12px; }
    .tl-rail { width: 12px; flex: none; display: flex; flex-direction: column; align-items: center; }
    .tl-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--itl-accent); margin-top: 6px; flex: none; }
    .tl-dot.now { background: var(--itl-bg); border: 2px solid var(--itl-ok); }
    .tl-dot.direct { background: var(--itl-muted); }
    .tl-body { flex: 1; min-width: 0; padding-bottom: 18px; display: flex; flex-direction: column; gap: 6px; }
    .tl-when { font-size: 12px; color: var(--itl-muted); display: flex; gap: 8px; align-items: center; }
    .tl-title { font-size: 14px; font-weight: 600; color: var(--itl-fg); text-decoration: none; }
    a.tl-title:hover { color: var(--itl-accent); text-decoration: underline; }
    .tl-why { margin: 0; font-size: 13px; line-height: 1.5; }
    .tl-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .tl-list li { display: flex; gap: 8px; align-items: flex-start; }
    .tl-list .ic { margin-top: 2px; }
    .tl-now { border: 1px dashed var(--itl-border); border-radius: 10px; padding: 10px 12px; }
    .token { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 8px 2px; }
    .token h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .token p { margin: 0; font-size: 13px; line-height: 1.5; }
    .token .note { color: var(--itl-muted); }
    .cmd { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 6px 6px 10px; border: 1px solid var(--itl-border); border-radius: 8px; background: var(--itl-subtle); }
    .cmd code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; background: none; padding: 0; }
    .launcher.warn { color: var(--itl-warn-fg); border-color: var(--itl-warn-border); }
    .empty { color: var(--itl-muted); padding: 32px 4px; text-align: center; }
    .empty p { margin: 6px 0; }

    .launcher { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; display: inline-flex; align-items: center; gap: 8px;
      border: 1px solid var(--itl-border); background: var(--itl-bg); color: var(--itl-fg); font-size: 13px; font-weight: 600;
      padding: 0 14px; height: 38px; border-radius: 999px; box-shadow: var(--itl-shadow); }
    .launcher.quiet { color: var(--itl-muted); font-weight: 500; box-shadow: none; }
    .launcher.quiet .accent { color: var(--itl-muted); }
    .launcher .badge { background: var(--itl-warn-bg); color: var(--itl-warn-fg); padding: 1px 8px; border-radius: 999px; font-size: 12px; }
    .launcher .okc { color: var(--itl-ok); }

    .pop { position: fixed; z-index: 2147483001; width: 360px; max-width: calc(100vw - 24px); background: var(--itl-bg); border: 1px solid var(--itl-border);
      border-radius: 12px; box-shadow: var(--itl-shadow); padding: 6px; display: flex; flex-direction: column; max-height: min(440px, calc(100vh - 24px)); overflow-y: auto; }
    .pop .why { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
    .pop .pi { padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .pop .pi + .pi { border-top: 1px solid var(--itl-border); }
    .pop .foot { display: flex; justify-content: flex-end; padding: 4px 6px 2px; }

    .toast { position: fixed; bottom: 72px; right: 24px; z-index: 2147483002; background: var(--itl-fg); color: var(--itl-bg); padding: 8px 12px; border-radius: 6px; font-size: 13px; }
  `;

  function ensurePageStyle() {
    if (document.getElementById('intent-trail-page-style')) return;
    const style = document.createElement('style');
    style.id = 'intent-trail-page-style';
    style.textContent = PAGE_CSS;
    document.head.append(style);
  }

  function ensureHost() {
    if (host?.isConnected) return;
    ensurePageStyle();
    host = h('div', { id: 'intent-trail-root' });
    shadow = host.attachShadow({ mode: 'open' });
    document.body.append(host);
  }

  function teardown() {
    host?.remove();
    host = null;
    document.documentElement.classList.remove('intent-trail-open');
    document.querySelectorAll('[data-intent-trail]').forEach((el) => el.remove());
    Object.assign(state, { mode: 'pr', pr: null, repoRef: null, history: null, tab: 'brief', data: null, view: null, error: null, loading: false, expanded: null, othersOpen: false, popover: null });
    state.chapterOpen = new Set();
    state.checked = new Set();
  }

  function setOpen(open) {
    state.open = open;
    rememberOpen(open);
    render();
  }

  function openTo({ tab = 'brief', expanded = null } = {}) {
    Object.assign(state, { tab, popover: null });
    if (expanded) state.expanded = expanded;
    setOpen(true);
  }

  function toast(text) {
    if (!shadow) return;
    const el = h('div', { class: 'toast', role: 'status' }, text);
    shadow.querySelector('.root')?.append(el);
    setTimeout(() => el.remove(), 2500);
  }

  // ---------- actions ----------
  function quoteFor(item) {
    const who = item.type === 'assumption' ? 'unverified assumption' : item.source === 'human' ? 'author’s ground rule' : 'agent’s call';
    const lines = [`> **Intent Trail** (${who}, ${V.agentInfo(item.turn.agent).label}): ${item.title}`];
    if (item.rationale) lines.push(`> ${item.rationale}`);
    if (item.alternatives?.length) lines.push(`> Rejected: ${item.alternatives.join('; ')}`);
    return lines.join('\n') + '\n\n';
  }

  function setNativeValue(textarea, value) {
    // React-controlled textareas ignore .value assignment; use the native setter + input event.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function ask(item) {
    const text = quoteFor(item);
    const box = document.querySelector('textarea#new_comment_field, textarea[name="comment[body]"], textarea[placeholder*="comment" i]');
    if (box) {
      setNativeValue(box, text + box.value);
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      box.focus();
      box.setSelectionRange(text.length, text.length);
      toast('Quoted into the comment box');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied. Paste it into a review comment.');
    } catch {
      toast('Could not find a comment box on this tab.');
    }
  }

  // GitHub anchors each file in the diff at #diff-<sha256(path)>.
  async function jumpTo(path) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const { owner, repo, number } = state.pr;
    const target = `/${owner}/${repo}/pull/${number}/files#diff-${hex}`;
    if (location.pathname.endsWith('/files')) location.hash = `diff-${hex}`;
    else location.assign(target);
  }

  function toggleCheck(item) {
    const on = !state.checked.has(item.id);
    if (on) state.checked.add(item.id);
    else state.checked.delete(item.id);
    render();
    const { owner, repo, number } = state.pr;
    api.setIntentCheck(owner, repo, number, reviewer(), item.id, on).catch(() => toast('Couldn’t save that check mark.'));
  }

  // ---------- pieces ----------
  function kindOf(item) {
    if (item.type === 'assumption') return { cls: 'assumption', label: 'Unverified assumption', icon: 'alert', icCls: 'warn-ic' };
    if (item.source === 'human') return { cls: 'human', label: `${state.view.authorFirst}’s call`, icon: 'person', icCls: 'human-ic' };
    return { cls: 'agent', label: 'Agent’s call', icon: 'spark', icCls: 'agent-ic' };
  }

  function chapterOf(item) {
    return state.view.chapters.find((c) => c.turns.includes(item.turn));
  }

  function detail(item, shownWhy) {
    const prFiles = state.data.files;
    const ch = chapterOf(item);
    return h(
      'div',
      { class: 'detail' },
      item.rationale && item.rationale !== shownWhy && h('div', null, item.rationale),
      item.alternatives?.length > 0 && h('div', { class: 'rej' }, h('strong', null, 'Rejected: '), item.alternatives.join('; ')),
      (item.files.length > 0 || !item.inDiff) &&
        h(
          'div',
          { class: 'chips' },
          item.files.map((f) => {
            const inPr = !prFiles || prFiles.includes(f);
            return h('button', { class: `file mono ${inPr ? '' : 'out'}`, title: inPr ? `Open ${f} in the diff` : `${f} is not in the final diff`, onclick: () => inPr && jumpTo(f) }, f.split('/').pop());
          }),
          !item.inDiff && h('span', { class: 'tag out' }, 'not in final diff'),
          item.explicit && h('span', { class: 'tag', title: 'Logged by the agent at the moment it decided' }, 'logged live'),
        ),
      h('div', { class: 'from' }, `From ${ch ? `“${ch.title}”` : `turn ${item.turn.turn_seq}`} · ${V.agentInfo(item.turn.agent).label} · ${fmtDay(item.turn.started_at)} ${fmtTime(item.turn.started_at)}`),
      h(
        'div',
        { class: 'actions' },
        item.files.length > 0 && item.inDiff && h('button', { class: 'btn', onclick: () => jumpTo(item.files.find((f) => !prFiles || prFiles.includes(f))) }, 'Jump to code'),
        h('button', { class: 'btn', onclick: () => ask(item) }, 'Ask in review'),
      ),
    );
  }

  // One decision row. `checkable` rows get the check-off control (the "needs your eyes" list).
  function row(item, { why, checkable = false } = {}) {
    const k = kindOf(item);
    const open = state.expanded === item.id;
    const checked = state.checked.has(item.id);
    // why: '' hides the summary line (compact rows); undefined falls back to the rationale.
    const shownWhy = why === '' ? '' : why ?? item.rationale;
    return h(
      'div',
      { class: `row ${open ? 'open' : ''} ${checked ? 'checked' : ''}` },
      h(
        'div',
        { class: 'row-top' },
        h('span', { class: `ic ${k.icCls}` }, icon(k.icon, 16, k.label)),
        h(
          'button',
          { class: 'row-main', 'aria-expanded': String(open), onclick: () => ((state.expanded = open ? null : item.id), render()) },
          h('span', { class: `kind ${k.cls}` }, k.label),
          h('span', { class: 'title' }, item.title),
          shownWhy && h('span', { class: 'why' }, shownWhy),
        ),
        checkable &&
          h(
            'button',
            { class: `check ${checked ? 'on' : ''}`, 'aria-label': checked ? 'Mark as not checked' : 'Mark as checked', 'aria-pressed': String(checked), onclick: () => toggleCheck(item) },
            icon(checked ? 'done' : 'ring', 22),
          ),
      ),
      open && detail(item, shownWhy),
    );
  }

  function metaLine() {
    const v = state.view;
    const m = v.meta;
    return h(
      'div',
      { class: 'meta' },
      m.agents.map((a) => h('span', { class: 'dot', style: `background:${a.color}` })),
      [m.agents.map((a) => a.label).join(' + '), m.authors.join(', '), `${plural(m.sessionCount, 'session')}, ${plural(m.turnCount, 'turn')}`].filter(Boolean).join(' · '),
    );
  }

  function briefTab() {
    const v = state.view;
    const done = v.attention.filter((a) => state.checked.has(a.item.id)).length;
    const total = v.attention.length;
    return [
      h(
        'section',
        null,
        h('div', { class: 'eyebrow' }, 'Goal'),
        h('p', { class: 'goal' }, v.goal || 'No summary yet.'),
        metaLine(),
        !v.generated && h('p', { class: 'note' }, 'Quick summary. The full brief is built on the author’s machine after their next agent turn.'),
      ),
      h(
        'section',
        null,
        h('div', { class: 'sec-head' }, h('h2', null, 'Needs your eyes'), total > 0 && h('span', null, done === total ? 'All checked' : `${done} of ${total} checked`)),
        total > 0 && h('div', { class: 'progress' }, h('div', { style: `width:${Math.round((done / total) * 100)}%` })),
        h('div', { class: 'list' }, total ? v.attention.map((a) => row(a.item, { why: a.why, checkable: true })) : h('div', { class: 'empty-row' }, 'Nothing flagged. The agent’s calls look routine.')),
      ),
      v.rules.length > 0 &&
        h(
          'section',
          null,
          h('div', { class: 'sec-head' }, h('h2', null, `Ground rules from ${v.authorFirst}`), h('span', null, 'Agent followed these')),
          h(
            'div',
            { class: 'rules' },
            v.rules.map((r) => h('span', { class: 'rule', title: r.items.map((i) => i.rationale).filter(Boolean).join('\n') || r.label }, icon('person', 13), r.label)),
          ),
        ),
      v.others.length > 0 &&
        h(
          'section',
          null,
          h(
            'button',
            { class: 'fold', 'aria-expanded': String(state.othersOpen), onclick: () => ((state.othersOpen = !state.othersOpen), render()) },
            h('span', { class: 'ic agent-ic' }, icon('spark', 16)),
            h('span', { class: 'grow' }, h('strong', null, `${plural(v.others.length, 'more agent call')}`), h('span', { class: 'note' }, v.counts.notInDiff ? ` · ${v.counts.notInDiff} not in the final diff` : ' · lower risk')),
            h('span', { class: 'ic chev' }, icon('chevron', 16)),
          ),
          state.othersOpen && h('div', { class: 'list compact' }, v.others.map((i) => row(i, { why: '' }))),
        ),
      h('button', { class: 'link', onclick: () => ((state.tab = 'story'), render()) }, 'See how this PR came together →'),
    ];
  }

  function storyTab() {
    const v = state.view;
    const m = v.meta;
    return [
      h(
        'section',
        { class: 'story-head' },
        h('h2', null, 'How this PR came together'),
        h('div', { class: 'meta', style: 'margin-top:4px' }, `${plural(m.sessionCount, 'session')} · ${plural(m.turnCount, 'turn')} · ${fmtDay(m.start)}, ${span(m.start, m.end)}`),
      ),
      h(
        'ol',
        { class: 'timeline' },
        v.chapters.map((c, idx) => {
          const open = state.chapterOpen.has(idx);
          const toggle = () => {
            if (open) state.chapterOpen.delete(idx);
            else state.chapterOpen.add(idx);
            render();
          };
          return h(
            'li',
            { class: 'ch' },
            h('div', { class: 'rail' }, h('div', { class: 'num' }, String(idx + 1)), h('div', { class: 'line' })),
            h(
              'div',
              { class: 'ch-body' },
              h('div', null, h('div', { class: 'ch-title' }, h('h3', null, c.title), h('span', null, span(c.start, c.end))), c.summary && h('p', { class: 'ch-sum' }, c.summary)),
              c.steer && h('div', { class: 'steer' }, icon('steer', 16), h('div', null, h('strong', null, 'Course correction: '), c.steer)),
              c.checkpoints.length > 0 && h('div', { class: 'cps' }, c.checkpoints.map((cp) => h('div', { class: 'cp' }, icon('check', 14), cp))),
              c.items.length > 0 &&
                h(
                  'button',
                  { class: 'pills', 'aria-expanded': String(open), title: open ? 'Hide decisions' : 'Show decisions', onclick: toggle },
                  c.counts.human > 0 && h('span', { class: 'pill human' }, `${c.counts.human} from ${v.authorFirst}`),
                  c.counts.agent > 0 && h('span', { class: 'pill agent' }, plural(c.counts.agent, 'agent call')),
                  c.counts.check > 0 && h('span', { class: 'pill warn' }, `${c.counts.check} to check`),
                  c.counts.assumptions > 0 && h('span', { class: 'pill warn' }, plural(c.counts.assumptions, 'assumption')),
                  h('span', { class: 'more' }, open ? 'Hide' : 'Show'),
                ),
              open && h('div', { class: 'list compact' }, c.items.map((i) => row(i, { why: '' }))),
            ),
          );
        }),
        h('li', { class: 'end' }, h('div', { class: 'ring' }), h('span', null, 'Now in review')),
      ),
      h('div', { class: 'privacy' }, 'Summaries are written on the author’s machine. Raw prompts and transcripts are never uploaded.'),
    ];
  }

  function historyTab() {
    const hs = state.history;
    if (!hs || hs.loading) return h('div', { class: 'empty' }, 'Loading history…');
    if (hs.error) return errorState({ error: hs.code, message: hs.error });
    const d = hs.data;
    const entries = V.buildTimeline(d.entries);
    const { owner, repo } = state.pr ?? state.repoRef;
    const prLink = (n) => `/${owner}/${repo}/pull/${n}`;
    const v = state.mode === 'pr' ? state.view : null;
    const merged = entries.filter((e) => e.pr).length;
    return [
      h(
        'section',
        { class: 'story-head' },
        h('h2', null, `Decisions on ${d.ref}`),
        h('div', { class: 'meta', style: 'margin-top:4px' }, entries.length ? `${plural(merged, 'merged PR')}${entries.length > merged ? ` · ${plural(entries.length - merged, 'direct commit')}` : ''} · newest first` : `Checked the last ${plural(d.scanned, 'commit')}`),
      ),
      h(
        'ol',
        { class: 'tl' },
        v?.sessions.length > 0 &&
          h(
            'li',
            { class: 'tl-e' },
            h('div', { class: 'tl-rail' }, h('div', { class: 'tl-dot now' })),
            h(
              'div',
              { class: 'tl-body tl-now' },
              h('div', { class: 'tl-when' }, h('span', { class: 'tag' }, 'In review'), state.data?.base ? `lands on ${state.data.base}` : null),
              h('span', { class: 'tl-title' }, `This PR #${state.pr.number}`),
              v.goal && h('p', { class: 'tl-why' }, v.goal),
              h('div', { class: 'chips' }, h('span', { class: 'pill human' }, `${v.counts.rules} ground rules`), h('span', { class: 'pill agent' }, plural(v.counts.agentCalls, 'agent call')), v.counts.attention > 0 && h('span', { class: 'pill warn' }, `${v.counts.attention} to check`)),
            ),
          ),
        entries.map((e, idx) => {
          const open = state.chapterOpen.has(`tl${idx}`);
          const toggle = () => {
            const k = `tl${idx}`;
            if (open) state.chapterOpen.delete(k);
            else state.chapterOpen.add(k);
            render();
          };
          const title = e.pr ? `#${e.pr.number} ${e.pr.title ?? e.subject}` : e.subject;
          return h(
            'li',
            { class: 'tl-e' },
            h('div', { class: 'tl-rail' }, h('div', { class: `tl-dot ${e.pr ? '' : 'direct'}` }), h('div', { class: 'line' })),
            h(
              'div',
              { class: 'tl-body' },
              h('div', { class: 'tl-when' }, h('span', null, fmtDay(e.date)), h('span', null, '·'), h('span', null, e.pr ? (e.pr.merge_kind === 'merge-commit' ? 'merge commit' : 'squash or rebase') : 'direct commit'), e.agents.map((a) => h('span', { class: 'dot', style: `background:${a.color}`, title: a.label }))),
              h('a', { class: 'tl-title', href: e.pr ? prLink(e.pr.number) : `/${owner}/${repo}/commit/${e.sha}` }, title),
              e.intent && h('p', { class: 'tl-why' }, e.intent),
              e.corrections.length > 0 && h('div', { class: 'steer' }, icon('steer', 16), h('div', null, h('strong', null, 'Course correction: '), e.corrections[0])),
              h(
                'button',
                { class: 'pills', 'aria-expanded': String(open), onclick: toggle },
                e.counts.human > 0 && h('span', { class: 'pill human' }, `${e.counts.human} from ${V.firstName(e.authors[0])}`),
                e.counts.agent > 0 && h('span', { class: 'pill agent' }, plural(e.counts.agent, 'agent call')),
                e.counts.assumptions > 0 && h('span', { class: 'pill warn' }, plural(e.counts.assumptions, 'assumption')),
                (e.rules.length > 0 || e.assumptions.length > 0) && h('span', { class: 'more' }, open ? 'Hide' : 'Show'),
              ),
              open &&
                h(
                  'ul',
                  { class: 'tl-list' },
                  e.rules.slice(0, TL_PREVIEW).map((r) => h('li', null, h('span', { class: 'ic human-ic' }, icon('person', 13)), r)),
                  e.assumptions.slice(0, TL_PREVIEW).map((a) => h('li', null, h('span', { class: 'ic warn-ic' }, icon('alert', 13)), a)),
                  e.rules.length + e.assumptions.length > 2 * TL_PREVIEW &&
                    h('li', null, h('a', { class: 'link', href: e.pr ? prLink(e.pr.number) : `/${owner}/${repo}/commit/${e.sha}` }, `+${Math.max(0, e.rules.length - TL_PREVIEW) + Math.max(0, e.assumptions.length - TL_PREVIEW)} more on the ${e.pr ? 'PR' : 'commit'}`)),
                ),
            ),
          );
        }),
      ),
      !entries.length &&
        h('div', { class: 'empty' }, h('p', null, h('strong', null, `No decisions recorded on ${d.ref} yet.`)), h('p', null, 'They appear when PRs with Intent Trail notes merge and ', h('code', null, 'intent-trail pr sync'), ' runs (locally or in CI).')),
      h('div', { class: 'privacy' }, 'Read from git notes (refs/notes/intent) in this repository.'),
    ];
  }

  function loadHistory(force = false) {
    const target = state.mode === 'pr' ? { ...state.pr, ref: state.data?.base ?? null } : state.repoRef;
    if (!target || (!force && state.history && !state.history.error)) return;
    void force; // the background asks GitHub every time; nothing to bypass
    const page = state.pr ?? state.repoRef;
    state.history = { loading: true };
    render();
    api
      .intentTimeline(target.owner, target.repo, target.ref)
      .then((data) => {
        if ((state.pr ?? state.repoRef) !== page) return; // navigated away meanwhile
        state.history = { data };
        render();
      })
      .catch((e) => {
        if ((state.pr ?? state.repoRef) !== page) return;
        state.history = { error: e.message, code: e.code };
        render();
      });
  }

  const needsToken = (e) => e && (e.error === 'no_token' || e.error === 'bad_token');

  // No token (or a rejected one) for this page's host: say which host, open its settings row, and
  // offer the GitHub CLI command that prints one.
  function tokenState(e) {
    const host = (state.pr ?? state.repoRef)?.host ?? location.host;
    const command = `gh auth token --hostname ${host} | pbcopy`;
    const missing = e.error === 'no_token';
    return h(
      'div',
      { class: 'token' },
      h('h2', null, missing ? `Add a token for ${host}` : `Replace the token for ${host}`),
      h('p', null, missing
        ? `Intent Trail reads this repository’s decisions through the GitHub API of ${host}, with a read-only token saved in this extension.`
        : `GitHub rejected the token saved for ${host}. It may have expired or lost access to this repository.`),
      h('button', { class: 'btn primary', onclick: () => api.openOptions().catch(() => toast('Couldn’t open the settings.')) }, missing ? 'Add a token' : 'Replace the token'),
      h('p', { class: 'note' }, 'The quickest way to get one is the GitHub CLI. This copies it:'),
      h(
        'div',
        { class: 'cmd' },
        h('code', null, command),
        h('button', { class: 'icon-btn', 'aria-label': 'Copy the command', title: 'Copy the command', onclick: () => navigator.clipboard.writeText(command).then(() => toast('Copied'), () => toast('Couldn’t copy')) }, icon('copy', 14)),
      ),
      h('p', { class: 'note' }, 'Then paste it on the settings page and click Save. The token stays in your browser.'),
    );
  }

  function errorState(e) {
    if (needsToken(e)) return tokenState(e);
    if (e.error === api.CONTEXT_INVALIDATED) return h('div', { class: 'empty' }, h('p', null, 'The extension was updated. Reload the page.'));
    return h('div', { class: 'empty' }, h('p', null, `Couldn’t read decisions: ${e.message ?? e.error}`));
  }

  function emptyState() {
    if (state.error) return errorState(state.error);
    return h(
      'div',
      { class: 'empty' },
      h('p', null, h('strong', null, 'No decisions recorded for this pull request.')),
      h('p', null, 'They appear when it is written with Claude Code or Codex and the Intent Trail plugin, which records the goal, the decisions and the assumptions behind the code.'),
      h('p', null, 'The ', h('button', { class: 'link', onclick: () => ((state.tab = 'history'), loadHistory(), render()) }, 'History'), ' tab shows decisions behind pull requests already merged here.'),
    );
  }

  function panel() {
    const v = state.view;
    const repoMode = state.mode === 'repo';
    const has = v?.sessions.length > 0;
    const tab = (id, label) =>
      h('button', { role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => {
        Object.assign(state, { tab: id, expanded: null });
        if (id === 'history') loadHistory();
        render();
      } }, label);
    let body;
    if (repoMode || state.tab === 'history') body = historyTab();
    else if (state.loading && !v) body = h('div', { class: 'empty' }, 'Loading…');
    else if (!has) body = emptyState();
    else body = state.tab === 'story' ? storyTab() : briefTab();
    return h(
      'aside',
      { class: 'panel', 'aria-label': 'Intent Trail' },
      h(
        'header',
        null,
        h('span', { class: 'accent' }, icon('compass', 18)),
        h('span', { class: 'name' }, repoMode ? 'Decision history' : 'Intent Trail'),
        !repoMode && h('div', { class: 'seg', role: 'tablist' }, has && tab('brief', 'Brief'), has && tab('story', 'Story'), tab('history', 'History')),
        h('button', { class: 'icon-btn', 'aria-label': 'Refresh', title: 'Refresh', onclick: () => (repoMode || state.tab === 'history' ? loadHistory(true) : load(true)) }, icon('refresh', 16)),
        h('button', { class: 'icon-btn', 'aria-label': 'Close panel', title: 'Close', onclick: () => setOpen(false) }, icon('x', 16)),
      ),
      h('div', { class: 'body' }, body),
    );
  }

  function remaining() {
    const v = state.view;
    return v ? v.attention.filter((a) => !state.checked.has(a.item.id)).length : 0;
  }

  // Bottom-right is shared with the stack navigator: sit just above it when it's there.
  function launcherOffset() {
    const navigator = document.querySelector('.ghs-navigator');
    return navigator?.isConnected ? Math.round(navigator.getBoundingClientRect().height) + 28 : 20;
  }

  function launcher() {
    if (state.mode === 'repo') {
      return h('button', { class: 'launcher', style: `bottom:${launcherOffset()}px`, 'aria-label': 'Open decision history', onclick: () => (setOpen(true), loadHistory()) }, h('span', { class: 'accent' }, icon('compass', 16)), 'Decisions');
    }
    const v = state.view;
    const has = v?.sessions.length > 0;
    const left = remaining();
    return h(
      'button',
      { class: `launcher ${needsToken(state.error) ? 'warn' : has ? '' : 'quiet'}`, style: `bottom:${launcherOffset()}px`, 'aria-label': has ? 'Open Intent Trail' : 'Open Intent Trail (no decisions recorded for this pull request)', onclick: () => openTo({}) },
      h('span', { class: 'accent' }, icon('compass', 16)),
      'Intent',
      state.loading && !v ? h('span', { class: 'note' }, '…') : null,
      state.error && !needsToken(state.error) ? h('span', { class: 'badge' }, '!') : null,
      needsToken(state.error) ? h('span', { style: 'margin-left:-4px' }, '· Add token') : null,
      has && left > 0 && h('span', { class: 'badge' }, String(left)),
      has && left === 0 && v.attention.length > 0 && h('span', { class: 'okc' }, icon('check', 14)),
    );
  }

  function popover() {
    const p = state.popover;
    const list = V.itemsForFile(state.view, p.path).slice(0, 3);
    const attention = new Map(state.view.attention.map((a) => [a.item.id, a.why]));
    const top = Math.max(12, Math.min(p.rect.bottom + 6, window.innerHeight - 452));
    const left = Math.max(12, Math.min(p.rect.right - 360, window.innerWidth - 372));
    return h(
      'div',
      { class: 'pop', role: 'dialog', 'aria-label': `Intent Trail for ${p.path}`, style: `top:${top}px;left:${left}px`, onclick: (e) => e.stopPropagation() },
      list.map((item) => {
        const k = kindOf(item);
        const checked = state.checked.has(item.id);
        const flagged = attention.has(item.id);
        return h(
          'div',
          { class: 'pi' },
          h('span', { class: `kind ${k.cls}`, style: 'display:flex;align-items:center;gap:6px' }, icon(k.icon, 14), k.label),
          h('span', { class: 'title' }, item.title),
          (attention.get(item.id) || item.rationale) && h('span', { class: 'why' }, attention.get(item.id) || item.rationale),
          item.alternatives?.length > 0 && h('span', { class: 'why' }, h('strong', { style: 'color:var(--itl-fg)' }, 'Rejected: '), item.alternatives.join('; ')),
          h(
            'div',
            { class: 'actions', style: 'padding-top:4px' },
            flagged && h('button', { class: `btn ${checked ? '' : 'primary'}`, onclick: () => toggleCheck(item) }, icon('check', 14), checked ? 'Checked' : 'Looks right'),
            h('button', { class: 'btn', onclick: () => ask(item) }, 'Ask in review'),
          ),
        );
      }),
      h('div', { class: 'foot' }, h('button', { class: 'link', onclick: () => openTo({ expanded: list[0]?.id }) }, 'Open in panel →')),
    );
  }

  // Pull requests always get the collapsed pill once loaded (the sidebar explains when there are no
  // records); repository pages only show the Decisions button when the default branch has records.
  function hasContent() {
    return state.mode === 'pr' ? !state.loading && (!!state.view || !!state.error) : state.history?.data?.entries.length > 0;
  }

  function render() {
    if (!state.pr && !state.repoRef) return;
    if (!hasContent()) {
      host?.remove();
      host = null;
      document.documentElement.classList.remove('intent-trail-open');
      return;
    }
    ensureHost();
    const scroll = shadow.querySelector('.body')?.scrollTop ?? 0;
    const root = h('div', { class: 'root' }, h('style', null, CSS));
    if (state.open) {
      root.append(panel());
      document.documentElement.classList.add('intent-trail-open');
    } else {
      root.append(launcher());
      document.documentElement.classList.remove('intent-trail-open');
    }
    if (state.popover && state.view) root.append(popover());
    shadow.replaceChildren(root);
    const body = shadow.querySelector('.body');
    if (body) body.scrollTop = scroll;
    decorate();
  }

  // ---------- anchors in GitHub's DOM (best effort; GitHub markup changes often) ----------
  const FILE_SELECTORS = ['[data-tagsearch-path]', '.file-header[data-path]', '[data-file-path]'];

  // The PR's tab bar (Conversation · Commits · Checks · Files changed), found by its own links:
  // the smallest visible element holding both the Commits and Files tabs. The strip goes right
  // above it, on its own line, under the title and status line.
  function tabsAnchor() {
    const base = `/pull/${state.pr.number}`;
    const visible = (el) => el.offsetParent !== null;
    const files = [...document.querySelectorAll(`a[href$="${base}/files"], a[href$="${base}/changes"]`)].find(visible);
    const commits = [...document.querySelectorAll(`a[href$="${base}/commits"]`)].find(visible);
    if (!files || !commits) return null;
    let el = files;
    while (el && !el.contains(commits)) el = el.parentElement;
    if (!el || el === document.body) return null;
    // Climb out of the row the tabs share with other things (e.g. the +/- diffstat) and of
    // single-child wrappers, so the strip gets a full-width line of its own above that row.
    for (let i = 0; i < 6 && el.parentElement && el.parentElement !== document.body; i++) {
      const parent = el.parentElement;
      const cs = getComputedStyle(parent);
      const sideBySide = (cs.display.includes('flex') && !cs.flexDirection.startsWith('column')) || cs.display.includes('grid');
      if (!sideBySide && parent.children.length > 1) break;
      el = parent;
    }
    return el;
  }

  function stripContent(strip) {
    const v = state.view;
    const left = remaining();
    strip.replaceChildren(
      h('span', { style: 'color:var(--itl-accent)' }, icon('compass', 18)),
      h('span', { class: 'itl-goal' }, h('strong', null, 'Goal: '), v.goal || 'see the Intent Trail panel'),
      v.attention.length > 0 &&
        (left > 0 ? h('span', { class: 'itl-pill itl-warn' }, icon('alert', 12), `${left} to check`) : h('span', { class: 'itl-pill itl-ok' }, icon('check', 12), 'All checked')),
      v.rules.length > 0 && h('span', { class: 'itl-muted' }, plural(v.rules.length, 'ground rule')),
    );
    strip.dataset.sig = `${v.goal}|${left}|${v.rules.length}`;
  }

  function decorate() {
    const v = state.view;
    if (state.mode !== 'pr' || !v?.sessions.length) return;

    let strip = document.querySelector('[data-intent-trail="strip"]');
    if (!strip) {
      const anchor = tabsAnchor();
      if (anchor) {
        strip = h('button', { 'data-intent-trail': 'strip', title: 'Open Intent Trail', onclick: () => openTo({}) });
        anchor.before(strip);
      }
    }
    if (strip && strip.dataset.sig !== `${v.goal}|${remaining()}|${v.rules.length}`) stripContent(strip);

    for (const el of document.querySelectorAll(FILE_SELECTORS.join(','))) {
      const path = el.getAttribute('data-tagsearch-path') || el.getAttribute('data-path') || el.getAttribute('data-file-path');
      const items = path && V.itemsForFile(v, path);
      if (!items?.length) continue;
      const toCheck = items.filter((i) => v.attention.some((a) => a.item.id === i.id) && !state.checked.has(i.id)).length;
      const label = toCheck ? `${toCheck} to check` : plural(items.length, 'decision');
      let chip = el.querySelector('[data-intent-trail="chip"]');
      if (!chip) {
        const target = el.querySelector('.file-info') || el.querySelector('[class*="file-name" i]')?.parentElement || el;
        chip = h('button', {
          'data-intent-trail': 'chip',
          onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            state.popover = state.popover?.path === path ? null : { path, rect: e.currentTarget.getBoundingClientRect() };
            render();
          },
        });
        target.append(chip);
      }
      if (chip.dataset.sig !== label) {
        chip.dataset.sig = label;
        chip.className = toCheck ? 'itl-warn' : 'itl-neutral';
        chip.title = `Intent Trail: ${plural(items.length, 'decision')} about this file`;
        chip.replaceChildren(toCheck ? icon('alert', 12) : icon('compass', 12), label);
      }
    }
  }

  // ---------- data ----------
  async function load(force = false) {
    const pr = state.pr;
    if (!pr) return;
    state.loading = true;
    state.error = null;
    render();
    void force; // the background asks GitHub every time; nothing to bypass
    let res;
    try {
      res = await api.intentPullRequest(pr.owner, pr.repo, pr.number, reviewer());
    } catch (e) {
      res = { error: e.code || 'error', message: e.message };
    }
    if (state.pr !== pr) return; // navigated away meanwhile
    state.loading = false;
    if (!res || res.error) {
      state.error = res ?? { error: 'error', message: 'no response' };
      state.view = null;
    } else {
      state.data = res;
      state.view = V.buildView(res);
      state.checked = new Set(res.checks ?? []);
      // First visit: open automatically when there is something to show; afterwards respect the user.
      if (storedOpen() === null && state.view.sessions.length) state.open = true;
    }
    render();
  }

  // Settings can switch the panel off; checked once per page.
  async function enabled() {
    try {
      return (await api.settings()).showIntentTrail !== false;
    } catch {
      return false;
    }
  }

  async function mountPullRequest(route, key) {
    teardown();
    if (!(await enabled()) || current !== key) return;
    state.mode = 'pr';
    state.pr = { host: route.host, owner: route.owner, repo: route.repository, number: route.number, key };
    state.open = storedOpen() === '1';
    load();
  }

  async function mountRepository(route, key) {
    teardown();
    if (!(await enabled()) || current !== key) return;
    state.mode = 'repo';
    state.repoRef = { host: route.host, owner: route.owner, repo: route.repository, ref: null, key };
    state.open = storedOpen() === '1';
    loadHistory(); // the Decisions button only appears when the default branch has records
    render();
  }

  let current = null;

  class IntentTrail {
    constructor() {
      this.key = null;
    }

    sync(route) {
      const key = `${route.kind}:${route.host}/${route.owner}/${route.repository}#${route.number ?? ''}`.toLowerCase();
      if (key !== this.key) {
        this.key = current = key;
        if (route.kind === 'pull_request') mountPullRequest(route, key);
        else mountRepository(route, key);
      } else if ((state.pr || state.repoRef) && !host?.isConnected) {
        render(); // GitHub replaced the page body
      } else {
        decorate(); // e.g. switched to Files changed: add file chips
      }
    }

    unmount() {
      if (!this.key) return;
      this.key = current = null;
      teardown();
    }
  }

  // Close the file-chip popover on outside click, Escape, or scroll (it is anchored to the chip).
  document.addEventListener('click', (e) => {
    if (!state.popover) return;
    const path = e.composedPath();
    if (path.includes(host) || path.some((n) => n?.dataset?.intentTrail === 'chip')) return;
    state.popover = null;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.popover) {
      state.popover = null;
      render();
    }
  });
  window.addEventListener('scroll', () => {
    if (state.popover) {
      state.popover = null;
      render();
    }
  }, { passive: true });

  root.GitHubStacks = Object.assign(root.GitHubStacks || {}, { IntentTrail });
})(globalThis);
