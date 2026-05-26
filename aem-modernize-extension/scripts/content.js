/* ============================================================
   AEM Modernize Tools — Agent Content Script v5
   Delegates all scanning to the background service worker
   (same engine used by the popup Scan Page button).
   Shows a floating panel with results on AEM content pages.
   ============================================================ */
(function () {
  'use strict';

  if (window.__aemModernizeAgentLoaded) return;
  window.__aemModernizeAgentLoaded = true;

  // Only run if URL contains a content path we can scan
  const href = window.location.href;
  const hasContentPath =
    href.includes('/editor.html/content/') ||
    href.includes('/sites.html/content/') ||
    /\/content\/[a-z]/.test(href);

  if (!hasContentPath) return;

  // ── Send message to background worker ─────────────────────
  function bgMsg(type, payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(resp || { ok: false });
      });
    });
  }

  // ── Outer-scope config (populated by init, used by renderPanel) ──
  let serverConfig = {};

  // Detect AEM base URL — if this content script is running, hasContentPath
  // already confirmed we're on an AEM content page. Just return the origin.
  function detectAEMBaseFromPage() {
    try {
      return window.location.origin;
    } catch (_) {
      return null;
    }
  }

  // ── Boot: run scan via background worker ───────────────────
  async function init() {
    // Wait for page to settle — editor pages take time to initialise
    await new Promise(r => setTimeout(r, 2000));

    // Auto-detect base URL — no config needed, session cookies handle auth
    const base = detectAEMBaseFromPage();
    serverConfig = { url: base };

    showBadge('↻ Scanning page…', '#4f9eff');

    const result = await bgMsg('SCAN_PAGE', {
      url:      '',    // background auto-detects from pageUrl
      user:     '',
      pass:     '',
      devToken: '',
      pageUrl:  window.location.href,
    });

    hideBadge();

    if (!result.ok) {
      showBadge('✗ ' + (result.error || 'Scan failed'), '#f56565', false, 6000);
      return;
    }

    renderPanel(result);
  }

  // Run on load, and also re-run if the URL changes (SPA navigation in AEM Sites)
  init();

  let lastHref = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastHref) {
      lastHref = window.location.href;
      // URL changed — re-run scan after brief delay
      if (/\/content\/[a-z]/.test(lastHref) || lastHref.includes('/editor.html/content/')) {
        document.getElementById('__aem-agent-panel__')?.remove();
        setTimeout(init, 2000);
      }
    }
  }, 1500);

  // ─────────────────────────────────────────────────────────
  // PANEL
  // ─────────────────────────────────────────────────────────
  function renderPanel(result) {
    document.getElementById('__aem-agent-panel__')?.remove();
    injectCSS();

    const legacy    = result.legacy    || [];
    const converted = result.converted || [];
    const total     = result.total     || 0;

    const tmpl      = result.templateStatus || {};
    const pagePath  = result.contentPath || '';

    const wrap = document.createElement('div');
    wrap.id    = '__aem-agent-panel__';
    wrap.innerHTML = `
      <div class="aap-panel" id="aap-panel">

        <div class="aap-header">
          <div class="aap-header-left">
            <span class="aap-dot ${legacy.length > 0 ? 'amber' : converted.length > 0 ? 'green' : 'dim'}"></span>
            <span class="aap-title">Modernize Agent</span>
          </div>
          <div class="aap-header-right">
            <button class="aap-icon" id="aap-rescan" title="Rescan">↺</button>
            <button class="aap-icon" id="aap-min"    title="Minimise">─</button>
            <button class="aap-icon" id="aap-close"  title="Close">✕</button>
          </div>
        </div>

        <!-- Environment context -->
        <div class="aap-env-bar">
          <div class="aap-env-row">
            <span class="aap-env-label">SERVER</span>
            <span class="aap-env-val">${esc(window.location.host)}</span>
          </div>
          <div class="aap-env-row">
            <span class="aap-env-label">PAGE</span>
            <span class="aap-env-val" title="${esc(pagePath)}">${esc(shortPath(pagePath))}</span>
          </div>
        </div>

        <!-- Status row -->
        <div class="aap-status-row">
          <div class="aap-status-cell">
            <span class="aap-status-label">PAGE TEMPLATE</span>
            <span class="aap-status-val ${tmpl.status === 'converted' ? 'green' : tmpl.status === 'legacy' ? 'amber' : 'dim'}">
              ${tmpl.status === 'converted' ? 'Editable ✓' : tmpl.status === 'legacy' ? 'Static (legacy)' : 'Unknown'}
            </span>
          </div>
          <div class="aap-status-divider"></div>
          <div class="aap-status-cell">
            <span class="aap-status-label">COMPONENTS</span>
            <span class="aap-status-val ${legacy.length === 0 ? 'green' : 'amber'}">${legacy.length === 0 ? 'All converted ✓' : legacy.length + ' need conversion'}</span>
          </div>
        </div>

        <!-- Stats: component count + rule counts -->
        <div class="aap-stats">
          <div class="aap-stat">
            <span class="aap-stat-n red">${legacy.length}</span>
            <span class="aap-stat-l">COMPONENTS</span>
          </div>
          <div class="aap-stat">
            <span class="aap-stat-n amber">${result.componentRuleCount || 0}</span>
            <span class="aap-stat-l">COMP RULES</span>
          </div>
          <div class="aap-stat">
            <span class="aap-stat-n muted">${result.templateRuleCount || 0}</span>
            <span class="aap-stat-l">TMPL RULES</span>
          </div>
        </div>

        <!-- Body -->
        <div class="aap-body" id="aap-body">
          ${legacy.length === 0 && total === 0
            ? noMatchHTML(result)
            : legacy.length === 0
              ? '<div class="aap-all-done">✓ No legacy components detected</div>'
              : legacyListHTML(legacy)
          }
        </div>

        <!-- Footer / actions -->
        <div class="aap-footer">
          <span class="aap-path" title="${esc(pagePath)}">${esc(shortPath(pagePath))}</span>
          <div style="display:flex;gap:5px;flex-shrink:0">
          ${(legacy.length > 0 || tmpl.status === 'legacy')
            ? `<button class="aap-convert-btn aap-convert-btn-full" id="aap-conv-full" title="Run full conversion (structure + components)">⚡ Full</button>`
            : ''
          }
          ${legacy.length > 0
            ? `<button class="aap-convert-btn" id="aap-conv-comp">Components</button>`
            : ''
          }
        </div>
        </div>

        ${tmpl.status === 'legacy'
          ? `<div class="aap-tmpl-warn">
               ⚠ Page uses a static template — run <strong>Page Structure</strong> conversion
               <button class="aap-conv-page-btn" id="aap-conv-page">Run</button>
             </div>`
          : ''
        }
      </div>`;

    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
      const p = document.getElementById('aap-panel');
      if (p) p.style.opacity = '1';
    });

    bindPanel(wrap, result);
  }

  function legacyListHTML(items) {
    return items.slice(0, 10).map(f => `
      <div class="aap-item">
        <div class="aap-item-left">
          <span class="aap-item-name">${esc(f.label || f.rt.split('/').pop())}</span>
          <span class="aap-item-rt" title="${esc(f.rt)}">${esc(shortRT(f.rt))}</span>
        </div>
        <span class="aap-arrow">→</span>
        <span class="aap-item-modern" title="${esc(f.modern || '')}">${esc(shortRT(f.modern || ''))}</span>
      </div>`).join('')
      + (items.length > 10
        ? `<div class="aap-more">+${items.length - 10} more legacy components</div>`
        : '');
  }

  function noMatchHTML(result) {
    const d = result.debug || {};
    const sample = (d.uniqueRTSample || []).slice(0, 5);
    const oldP   = (d.oldAppsPrefixes || []).join(', ') || '(none)';
    const newP   = (d.newAppsPrefixes || []).join(', ') || '(none)';
    return `<div class="aap-no-match">
      <div class="aap-no-match-title">No components found</div>
      ${d.totalNodes
        ? `<div class="aap-no-match-hint">${d.totalNodes} nodes scanned — no RTs matched your configured paths.</div>
           <div class="aap-no-match-hint">Old prefix: <span class="red">${esc(oldP)}</span></div>
           <div class="aap-no-match-hint">New prefix: <span class="green">${esc(newP)}</span></div>
           ${sample.length ? '<div class="aap-no-match-hint">RTs on page:</div>'
             + sample.map(rt => `<div class="aap-rt-chip">${esc(shortRT(rt))}</div>`).join('') : ''}
           <div class="aap-no-match-hint" style="color:#4f9eff;margin-top:4px">→ Update paths in Settings</div>`
        : '<div class="aap-no-match-hint">No conversion rules matched. Check server connection.</div>'
      }
    </div>`;
  }

  // ─────────────────────────────────────────────────────────
  // BIND EVENTS
  // ─────────────────────────────────────────────────────────
  function bindPanel(wrap, result) {
    const $ = id => document.getElementById(id);

    $('aap-close')?.addEventListener('click', () => wrap.remove());

    $('aap-min')?.addEventListener('click', () => {
      const body   = $('aap-body');
      const footer = wrap.querySelector('.aap-footer');
      const bar    = wrap.querySelector('.aap-bar-wrap');
      const warn   = wrap.querySelector('.aap-tmpl-warn');
      const hidden = body?.style.display === 'none';
      [body, footer, bar, warn].forEach(el => { if (el) el.style.display = hidden ? '' : 'none'; });
      $('aap-min').textContent = hidden ? '─' : '▢';
    });

    $('aap-rescan')?.addEventListener('click', async () => {
      wrap.remove();
      await init();
    });

    $('aap-conv-full')?.addEventListener('click', () => {
      openConvDialog(result, 'full');
    });
    $('aap-conv-comp')?.addEventListener('click', () => {
      openConvDialog(result, 'component');
    });

    $('aap-conv-page')?.addEventListener('click', () => {
      openConvDialog(result, 'page-structure');
    });
  }

  // ─────────────────────────────────────────────────────────
  // CONVERSION DIALOG
  // ─────────────────────────────────────────────────────────
  function openConvDialog(result, tool) {
    document.getElementById('__aem-conv-dlg__')?.remove();
    injectCSS();

    const pagePath = result.contentPath || '';
    const legacy   = result.legacy || [];
    const isComp   = tool === 'component';
    const isFull   = tool === 'full';

    const d  = document.createElement('div');
    d.id     = '__aem-conv-dlg__';
    d.innerHTML = `
      <div class="acd-overlay">
        <div class="acd-box">
          <div class="acd-hdr">
            <span class="acd-title">${isFull ? '⚡ Full Conversion (Structure + Components)' : isComp ? 'Convert Components' : 'Convert Page Structure'}</span>
            <button id="acd-x">✕</button>
          </div>

          <div class="acd-section">Page</div>
          <div class="acd-path">${esc(pagePath)}</div>

          ${isComp && legacy.length ? `
          <div class="acd-section">${legacy.length} Legacy Components</div>
          <div class="acd-items">
            ${legacy.slice(0, 6).map(f => `
              <div class="acd-row">
                <span class="acd-rl">${esc(f.label || f.rt.split('/').pop())}</span>
                <span class="acd-ro">${esc(shortRT(f.rt))}</span>
                <span>→</span>
                <span class="acd-rn">${esc(shortRT(f.modern || ''))}</span>
              </div>`).join('')}
            ${legacy.length > 6 ? `<div class="acd-more">+${legacy.length - 6} more</div>` : ''}
          </div>` : ''}

          ${!isComp ? `
          <div class="acd-section">Template</div>
          <div class="acd-path">${esc((result.templateStatus || {}).template || 'Unknown')}</div>` : ''}


          <div class="acd-warn">⚠ This modifies content in AEM. Test on non-production first.</div>

          <div class="acd-actions">
            <button id="acd-cancel">Cancel</button>
            <button id="acd-confirm">⚡ Run ${isFull ? 'Full' : isComp ? 'Component' : 'Page'} Conversion</button>
          </div>
          <div id="acd-status" class="acd-status"></div>
        </div>
      </div>`;

    document.body.appendChild(d);
    d.querySelector('#acd-x').addEventListener('click',      () => d.remove());
    d.querySelector('#acd-cancel').addEventListener('click', () => d.remove());
    d.querySelector('#acd-confirm').addEventListener('click', () => submitConv(d, pagePath, tool, result));
  }

  async function submitConv(d, pagePath, tool, scanResult) {
    const stored = await new Promise(r => chrome.storage.local.get(['serverConfig'], r));
    const sc     = stored.serverConfig || {};

    const btn = d.querySelector('#acd-confirm');
    btn.disabled    = true;
    btn.textContent = 'Submitting…';
    setDlgSt(d, 'Sending request to AEM…', 'info');

    // Content script runs IN the page — fetch() automatically gets the correct
    // Referer header, which is what Felix/Sling CSRF filter requires.
    // We do NOT go through the background worker here.
    try {
      // Auto-detected base — no explicit auth needed, session cookies handle it
      const base = window.location.origin;
      const auth = null; // browser sends AEM session cookies automatically

      const ENDPOINTS = {
        'component':       '/mnt/overlay/aem-modernize/content/component/job/create.json',
        'page-structure':  '/mnt/overlay/aem-modernize/content/structure/job/create.json',
        'responsive-grid': '/mnt/overlay/aem-modernize/content/responsive-grid/job/create.json',
        'full':            '/mnt/overlay/aem-modernize/content/full/job/create.json',
      };
      const endpoint = ENDPOINTS[tool] || ENDPOINTS['component'];

      // Step 1: get CSRF token — running in page context so Referer is correct
      let csrfToken = '';
      if (!sc.devToken) {
        const tr = await fetch(base + '/libs/granite/csrf/token.json', {
          headers: { Authorization: auth },
        });
        if (tr.ok) { const tj = await tr.json(); csrfToken = tj.token || ''; }
      }

      // Step 2: build the confirmed correct payload format from network trace:
      // Single "data" parameter containing JSON with:
      //   name, type, paths (component jcr paths), componentRules, templateRules, policyRules, overwrite

      // Use rule IDs directly from scanResult — already correctly fetched during scan
      // scanResult.componentRuleIds = ["/var/componentconversion/set/rule1", ...]
      // scanResult.templateRuleIds  = ["com.corteva...Rule~page-name", ...]
      const legacyComponents  = scanResult ? (scanResult.legacy  || []) : [];
      const componentRuleIds  = scanResult ? (scanResult.componentRuleIds || []) : [];
      const templateRuleIds   = scanResult ? (scanResult.templateRuleIds  || []) : [];

      // Component paths from scan result
      const componentPaths = legacyComponents.length > 0
        ? [...new Set(legacyComponents.map(f => f.path).filter(Boolean))]
        : [pagePath + '/jcr:content'];

      const jobName = 'ext-' + Date.now();
      let dataObj;

      if (tool === 'page-structure') {
        dataObj = {
          name: jobName, type: 'STRUCTURE',
          paths:          [pagePath],
          templateRules:  templateRuleIds,
          policyRules:    [],
          componentRules: [],
          overwrite: false, sourceRoot: '', targetRoot: '', pageHandling: 'NONE',
        };
      } else if (tool === 'full') {
        dataObj = {
          name: jobName, type: 'FULL',
          paths:          [pagePath],   // page path only for full conversion
          templateRules:  templateRuleIds,
          policyRules:    [],
          componentRules: componentRuleIds,
          overwrite: false, sourceRoot: '', targetRoot: '', pageHandling: 'NONE',
        };
      } else {
        dataObj = {
          name: jobName, type: 'COMPONENT',
          paths:          componentPaths,
          templateRules:  [],
          policyRules:    [],
          componentRules: componentRuleIds,
          overwrite: false,
        };
      }

      const body = new URLSearchParams({ data: JSON.stringify(dataObj) });
      if (csrfToken) body.append(':cq_csrf_token', csrfToken);

      const finalResp = await fetch(base + endpoint, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/x-www-form-urlencoded',
          ...(auth ? { 'Authorization': auth } : {}),
          'CSRF-Token':    csrfToken,
          'X-CSRF-Token':  csrfToken,
        },
        body:        body.toString(),
        credentials: 'include',
      });
      const finalText = await finalResp.text();
      let finalJson = null;
      try { finalJson = JSON.parse(finalText); } catch (_) {}

      if (finalResp.ok) {
        if (finalJson && finalJson.success === false) {
          setDlgSt(d, '✗ AEM error: ' + (finalJson.message || 'unknown'), 'err');
          btn.disabled = false; btn.textContent = '↺ Retry';
          return;
        }
        // Response: {success, message, paths, rules} — no job object
        // Use the job name we generated as the ID
        setDlgSt(d, '✓ Job submitted — ' + jobName, 'ok');
        btn.textContent = '✓ Done';
        // Don't auto-close — let user see the job ID
        btn.onclick = () => d.remove();
      } else {
        setDlgSt(d, '✗ HTTP ' + finalResp.status + ' — ' + finalText.slice(0, 200), 'err');
        btn.disabled = false; btn.textContent = '↺ Retry';
      }
    } catch (e) {
      setDlgSt(d, '✗ ' + e.message, 'err');
      btn.disabled = false; btn.textContent = '↺ Retry';
    }
  }

  function setDlgSt(d, msg, type) {
    const el = d.querySelector('#acd-status');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'acd-status ' + (type || '');
  }

  // ─────────────────────────────────────────────────────────
  // BADGE (scanning indicator)
  // ─────────────────────────────────────────────────────────
  function showBadge(msg, color, clickable, autohide) {
    hideBadge();
    const el = document.createElement('div');
    el.id = '__aem-badge__';
    el.style.cssText = `position:fixed;bottom:16px;right:16px;z-index:2147483640;
      background:#0f1117;border:1px solid ${color};border-radius:8px;
      padding:8px 14px;font:11px ui-monospace,monospace;color:${color};
      display:flex;align-items:center;gap:8px;
      box-shadow:0 4px 20px rgba(0,0,0,.4);transition:opacity .3s;
      ${clickable ? 'cursor:pointer;' : ''}`;
    el.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>${esc(msg)}`;
    if (clickable) el.title = 'Click to open Settings';
    document.body.appendChild(el);
    if (autohide) setTimeout(() => hideBadge(), autohide);
  }

  function hideBadge() {
    document.getElementById('__aem-badge__')?.remove();
  }

  // ─────────────────────────────────────────────────────────
  // CSS
  // ─────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('__aem-agent-css__')) return;
    const s = document.createElement('style');
    s.id    = '__aem-agent-css__';
    s.textContent = `
/* AEM Modernize Agent — Light Theme */
#__aem-agent-panel__ {
  position:fixed;bottom:16px;right:16px;z-index:2147483640;
  font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
#__aem-agent-panel__ * { box-sizing:border-box; }
.aap-panel {
  width:300px;background:#fff;border:1px solid #e2e6ec;
  border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.12);
  overflow:hidden;opacity:0;transition:opacity .25s;
}
.aap-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 11px;background:#f8f9fb;border-bottom:1px solid #e2e6ec;
}
.aap-header-left,.aap-header-right { display:flex;align-items:center;gap:5px; }
.aap-title { font-weight:700;font-size:11px;color:#111827; }
.aap-dot { width:7px;height:7px;border-radius:50%;flex-shrink:0; }
.aap-dot.amber { background:#d97706; }
.aap-dot.green { background:#16a34a; }
.aap-dot.dim   { background:#9ca3af; }
.aap-icon { background:none;border:none;color:#9ca3af;cursor:pointer;padding:2px 5px;border-radius:3px;font-size:11px; }
.aap-icon:hover { color:#111827;background:#f1f3f6; }

.aap-env-bar {
  display:flex;flex-direction:column;gap:3px;
  background:#eff4ff;border-bottom:1px solid #bfdbfe;padding:6px 11px;
}
.aap-env-row { display:flex;align-items:center;gap:6px; }
.aap-env-label {
  font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
  color:#2563eb;min-width:36px;flex-shrink:0;
}
.aap-env-val {
  font-size:9px;color:#374151;font-family:ui-monospace,monospace;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;
}
.aap-status-row { display:flex;background:#f8f9fb;border-bottom:1px solid #e2e6ec; }
.aap-status-cell { flex:1;padding:6px 10px;display:flex;flex-direction:column;gap:2px; }
.aap-status-divider { width:1px;background:#e2e6ec;margin:5px 0; }
.aap-status-label { font-size:8px;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af; }
.aap-status-val { font-size:11px;font-weight:600;color:#4b5563; }
.aap-status-val.green { color:#16a34a; }
.aap-status-val.amber { color:#d97706; }
.aap-status-val.dim   { color:#9ca3af; }

.aap-stats {
  display:flex;padding:8px 11px;background:#fff;
  border-bottom:1px solid #e2e6ec;justify-content:space-around;
}
.aap-stat { display:flex;flex-direction:column;align-items:center;gap:2px; }
.aap-stat-n { font-size:18px;font-weight:700;line-height:1; }
.aap-stat-n.red   { color:#dc2626; }
.aap-stat-n.green { color:#16a34a; }
.aap-stat-n.muted { color:#9ca3af; }
.aap-stat-n.amber { color:#d97706; }
.aap-stat-l { font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af; }

.aap-bar-wrap { padding:0 11px 6px;background:#fff;border-bottom:1px solid #e2e6ec; }
.aap-bar { height:3px;background:#f1f3f6;border-radius:99px;overflow:hidden; }
.aap-bar-fill { height:100%;background:linear-gradient(90deg,#2563eb,#16a34a);border-radius:99px;transition:width .5s; }

.aap-body { max-height:200px;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:3px; }
.aap-body::-webkit-scrollbar { width:3px; }
.aap-body::-webkit-scrollbar-thumb { background:#e2e6ec;border-radius:99px; }

.aap-item { display:flex;align-items:center;gap:5px;padding:5px 8px;background:#f8f9fb;border-radius:5px;border-left:2px solid #dc2626; }
.aap-item-left { flex:1;min-width:0;display:flex;flex-direction:column;gap:1px; }
.aap-item-name { font-size:10px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.aap-item-rt   { font-size:8px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.aap-arrow     { color:#e2e6ec;font-size:10px;flex-shrink:0; }
.aap-item-modern { font-size:8px;color:#16a34a;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0; }
.aap-more      { font-size:9px;color:#9ca3af;padding:3px 6px; }
.aap-all-done  { font-size:10px;color:#16a34a;padding:10px;text-align:center; }

.aap-no-match  { padding:8px;display:flex;flex-direction:column;gap:3px; }
.aap-no-match-title { font-weight:700;font-size:10px;color:#4b5563; }
.aap-no-match-hint  { font-size:9px;color:#9ca3af;line-height:1.5; }
.aap-no-match-hint .red   { color:#dc2626; }
.aap-no-match-hint .green { color:#16a34a; }
.aap-rt-chip { font-size:8px;color:#2563eb;padding:1px 5px;background:#eff4ff;border-radius:3px;margin:1px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }

.aap-footer { display:flex;align-items:center;justify-content:space-between;padding:6px 11px;border-top:1px solid #e2e6ec; }
.aap-path { font-size:9px;color:#c7d0db;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.aap-convert-btn {
  background:#2563eb;border:none;color:#fff;
  font:700 9px -apple-system,sans-serif;padding:4px 9px;border-radius:4px;cursor:pointer;
  flex-shrink:0;transition:background .15s;
}
.aap-convert-btn:hover { background:#1d4ed8; }
.aap-convert-btn-full { background:#1d4ed8;font-weight:700; }
.aap-convert-btn-full:hover { background:#1e40af; }

.aap-tmpl-warn {
  display:flex;align-items:center;gap:8px;
  padding:7px 11px;background:#fefce8;border-top:1px solid #fde68a;
  font-size:10px;color:#d97706;
}
.aap-conv-page-btn {
  background:none;border:1px solid #fde68a;color:#d97706;
  font:700 9px -apple-system,sans-serif;padding:3px 8px;border-radius:4px;
  cursor:pointer;flex-shrink:0;margin-left:auto;
}
.aap-conv-page-btn:hover { background:#fef3c7; }

/* Dialog */
#__aem-conv-dlg__ { position:fixed;inset:0;z-index:2147483647;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
#__aem-conv-dlg__ * { box-sizing:border-box; }
.acd-overlay { position:absolute;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center; }
.acd-box { width:440px;background:#fff;border:1px solid #e2e6ec;border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 8px 32px rgba(0,0,0,.12);animation:acd-in .2s ease; }
@keyframes acd-in { from{opacity:0;transform:scale(.97) translateY(6px)} to{opacity:1;transform:none} }
.acd-hdr { display:flex;align-items:center;justify-content:space-between; }
.acd-title { font-weight:700;font-size:14px;color:#111827; }
#acd-x { background:none;border:none;color:#9ca3af;cursor:pointer;font-size:14px;padding:3px 6px; }
#acd-x:hover { color:#111827; }
.acd-section { font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#9ca3af;font-weight:600; }
.acd-path { font-size:11px;color:#4b5563;padding:5px 8px;background:#f8f9fb;border-radius:4px;border:1px solid #e2e6ec;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.acd-items { display:flex;flex-direction:column;gap:2px;max-height:110px;overflow-y:auto; }
.acd-row { display:flex;align-items:center;gap:5px;padding:4px 7px;background:#f8f9fb;border-radius:4px;font-size:10px;border:1px solid #e2e6ec; }
.acd-rl { color:#111827;font-weight:700;min-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.acd-ro { color:#dc2626;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px; }
.acd-rn { color:#16a34a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px; }
.acd-more { font-size:9px;color:#9ca3af;padding:2px 6px; }
.acd-opts label { display:flex;align-items:center;gap:6px;font-size:11px;color:#4b5563;cursor:pointer; }
.acd-opts input { accent-color:#2563eb; }
.acd-warn { font-size:10px;color:#d97706;padding:7px 9px;background:#fefce8;border:1px solid #fde68a;border-radius:5px;line-height:1.5; }
.acd-actions { display:flex;gap:8px; }
#acd-cancel,#acd-confirm { font:600 12px -apple-system,sans-serif;border-radius:6px;padding:9px 14px;cursor:pointer;transition:all .15s; }
#acd-cancel  { background:#fff;border:1px solid #e2e6ec;color:#4b5563;flex:.5; }
#acd-cancel:hover { border-color:#2563eb;color:#2563eb; }
#acd-confirm { background:#2563eb;border:none;color:#fff;flex:1; }
#acd-confirm:hover { background:#1d4ed8; }
#acd-confirm:disabled { background:#f1f3f6;color:#9ca3af; }
.acd-status { display:none;font-size:11px;padding:7px 9px;border-radius:5px; }
.acd-status.ok   { display:block;background:#dcfce7;color:#16a34a;border:1px solid #bbf7d0; }
.acd-status.err  { display:block;background:#fee2e2;color:#dc2626;border:1px solid #fecaca; }
.acd-status.info { display:block;background:#eff4ff;color:#2563eb;border:1px solid #bfdbfe; }
    `;
    document.head.appendChild(s);
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────
  function shortRT(rt) {
    if (!rt) return '';
    const p = rt.split('/');
    return p.length > 3 ? '…/' + p.slice(-2).join('/') : rt;
  }
  function shortPath(p) {
    if (!p) return '';
    const parts = p.split('/');
    return parts.length > 4 ? '…/' + parts.slice(-2).join('/') : p;
  }
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

})();
