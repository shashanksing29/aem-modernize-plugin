/* ============================================================
   AEM Modernize Tools — Background Service Worker (MV3)
   All cross-origin fetches route through here (CORS/CSP safe).
   ============================================================ */

// ── Alarms ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('pollJobs', { periodInMinutes: 0.5 });
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'pollJobs') await checkRunningJobs();
});

// ── Message router ────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'TEST_CONNECTION': handleTestConnection(msg.payload).then(sendResponse); return true;
    case 'FETCH_AEM':       handleFetchAEM(msg.payload).then(sendResponse);       return true;
    case 'FETCH_RULES':     handleFetchRules(msg.payload).then(sendResponse);     return true;
    case 'SUBMIT_JOB':      handleSubmitJob(msg.payload).then(sendResponse);      return true;
    case 'CSRF_TOKEN':      handleGetCSRFToken(msg.payload).then(sendResponse);   return true;
    case 'SCAN_PAGE':
      handleScanPage(msg.payload).then(sendResponse);
      return true;

    case 'TEST_PATH':
      handleTestPath(msg.payload).then(sendResponse);
      return true;

    case 'JOBS_SUBMITTED':
      chrome.storage.local.get(['jobs'], (d) =>
        chrome.storage.local.set({ jobs: d.jobs || [], lastSubmitAt: Date.now() }));
      sendResponse({ ok: true });
      return false;
  }
});

// ─────────────────────────────────────────────────────────
// LOW-LEVEL HTTP HELPERS
// ─────────────────────────────────────────────────────────

// Build Authorization header value.
// Bearer token bypasses AEM CSRF entirely — use when available.
// For localhost, Basic Auth also bypasses CSRF (AEM local dev default).
function makeAuth(user, pass, devToken) {
  if (devToken && devToken.trim()) {
    return 'Bearer ' + devToken.trim();
  }
  return 'Basic ' + btoa((user || 'admin') + ':' + (pass || 'admin'));
}

function isLocalUrl(url) {
  return url && (url.includes('localhost') || url.includes('127.0.0.1'));
}

// Detect AEM environment type and base URL from any AEM page URL
// Supports:
//   AEMaaCS:   https://author-p12345-e67890.adobeaemcloud.com/...
//   Cloud SDK: http://localhost:4502/...
//   AEM 6.5:   http://hostname:4502/... or https://author.mycompany.com/...
function detectAEMEnvironment(tabUrl) {
  if (!tabUrl) return null;
  try {
    const u = new URL(tabUrl);
    const origin = u.origin; // e.g. "https://author-p107537-e1544285.adobeaemcloud.com"

    // AEMaaCS pattern: author-p<programId>-e<envId>.adobeaemcloud.com
    if (u.hostname.match(/^author-p\d+-e\d+\.adobeaemcloud\.com$/)) {
      return { base: origin, type: 'cloud', isLocal: false };
    }
    // AEM Cloud SDK / local
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return { base: origin, type: 'local', isLocal: true };
    }
    // AEM 6.5 on-prem or any other author hostname
    // Heuristic: if path contains /editor.html/content/ or /sites.html — it's AEM
    if (u.pathname.includes('/editor.html/') || u.pathname.includes('/sites.html') || u.pathname.includes('/ui#/aem/')) {
      return { base: origin, type: 'onprem', isLocal: false };
    }
    return { base: origin, type: 'unknown', isLocal: false };
  } catch (_) {
    return null;
  }
}

async function aemFetch(url, auth, opts) {
  opts = opts || {};
  try {
    const r = await fetch(url, {
      method:   opts.method  || 'GET',
      headers:  Object.assign({ 'Authorization': auth, 'Accept': 'application/json, */*' }, opts.headers || {}),
      body:     opts.body    || undefined,
      redirect: 'follow',
      signal:   AbortSignal.timeout(opts.timeout || 12000),
    });
    const text = await r.text();
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.message };
  }
}

function tryJSON(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

// AEM HTTP 300 body: { "0": "/path/set.1.json", "1": "/path/set.0.json" }
// This is NOT the node data — it's a redirect menu. Detect and skip it.
function is300Redirect(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  return keys.length > 0
    && keys.every(k => /^\d+$/.test(k))
    && Object.values(obj).every(v => typeof v === 'string' && v.includes('.json'));
}

// Keys that are JCR/Sling metadata, not content children
function isMetaKey(k) {
  return k.startsWith('jcr:') || k.startsWith(':') || k.startsWith('cq:') ||
         k === 'rep:policy' || k === 'sling:target';
}

// ─────────────────────────────────────────────────────────
// TEST CONNECTION
// ─────────────────────────────────────────────────────────
async function handleTestConnection({ url, user, pass, devToken }) {
  if (!url) return { ok: false, error: 'No URL provided' };
  const auth = makeAuth(user, pass, devToken);
  const base = url.replace(/\/$/, '');
  for (const ep of [
    '/libs/granite/core/content/login.html',
    '/system/sling/info.sessionInfo.json',
    '/bin/querybuilder.json?type=nt:base&p.limit=1',
  ]) {
    const r = await aemFetch(base + ep, auth, { timeout: 6000 });
    if (r.status === 401) return { ok: false, error: 'HTTP 401 — wrong credentials' };
    if (r.status > 0 && r.status < 500) return { ok: true, status: r.status };
  }
  return { ok: false, error: 'Server unreachable' };
}

// ─────────────────────────────────────────────────────────
// GENERIC AEM GET
// ─────────────────────────────────────────────────────────
async function handleFetchAEM({ url, path, user, pass, devToken }) {
  const auth = makeAuth(user, pass, devToken);
  const r    = await aemFetch(url.replace(/\/$/, '') + path, auth);
  if (!r.ok) return { ok: false, status: r.status, error: 'HTTP ' + r.status };
  return { ok: true, status: r.status, text: r.text, json: tryJSON(r.text) };
}

// ─────────────────────────────────────────────────────────
// SCAN PAGE — fetches page JSON and classifies all components
// ─────────────────────────────────────────────────────────
async function handleScanPage({ url, user, pass, devToken, pageUrl }) {
  try {
    const contentPath = extractContentPathFromURL(pageUrl);
    if (!contentPath) return { ok: false, error: 'Could not extract content path from URL: ' + pageUrl };

    // Auto-detect environment from page URL — use tab origin if no server configured
    const envDetected = detectAEMEnvironment(pageUrl);
    const base = (url && url.trim()) ? url.replace(/\/$/, '')
               : envDetected         ? envDetected.base
               : null;
    if (!base) return { ok: false, error: 'Could not determine AEM server URL. Configure it in Settings or open an AEM editor page.' };

    // Auth: use configured credentials if set, otherwise rely on browser session cookies
    // Browser cookies are automatically sent for same-origin requests (background fetch)
    // For cross-origin background requests, cookies are NOT sent — but content script
    // fetches (executeScript) run in page context and DO send session cookies automatically.
    const useSessionCookies = !user && !devToken;
    const auth = useSessionCookies ? null : makeAuth(user, pass, devToken);

    // ── Use AEM Modernize Tools native endpoints ───────────────────────
    // These are the same endpoints the tool UI uses — no need for
    // manual apps/conf path configuration or infinity.json parsing.

    // ── Component detection via .component.rules.json ────────────────
    // Confirmed response: { success, message, paths: [...componentPaths], rules: [{id, title}] }
    // paths = component JCR paths that need conversion
    // rules = matching rule node paths from /var/componentconversion/set/
    // If rules.length > 0 → page has legacy components needing conversion
    let legacy        = [];
    let converted     = [];
    let total         = 0;
    let componentRuleIds = [];

    const compRulesUrl = base
      + '/mnt/overlay/aem-modernize/content/component/job/create.component.rules.json'
      + '?path=' + encodeURIComponent(contentPath) + '&reprocess=false';

    const compRulesResp = await aemFetch(compRulesUrl, auth, { timeout: 15000 });
    if (compRulesResp.ok) {
      const cr = tryJSON(compRulesResp.text);
      if (cr && cr.success) {
        const compPaths = Array.isArray(cr.paths) ? cr.paths : [];
        const rules     = Array.isArray(cr.rules) ? cr.rules : [];
        componentRuleIds = rules.map(r => r.id).filter(Boolean);

        total = compPaths.length;
        if (rules.length > 0) {
          // Has matching rules → these component paths need conversion
          for (const p of compPaths) {
            legacy.push({
              path:        p,
              rt:          '',
              label:       p.split('/').pop(),
              modern:      '',
              rule:        { ruleName: rules[0] ? rules[0].id.split('/').pop() : '' },
              contentPath: extractPagePath(p),
              source:      'aem-native',
              ruleCount:   rules.length,
              ruleIds:     componentRuleIds,
            });
          }
        } else if (compPaths.length > 0) {
          // Paths returned but no rules → already converted
          for (const p of compPaths) {
            converted.push({ path: p, rt: '', label: p.split('/').pop(), source: 'aem-native' });
          }
        }
      }
    }

    // Fallback: infinity.json + detection paths when component.rules.json returns nothing
    if (legacy.length === 0 && converted.length === 0) {
      const stored2 = await new Promise(r => chrome.storage.local.get(['detectionPaths'], r));
      const dp      = stored2.detectionPaths || {};
      const oldPfx  = splitPaths(dp.oldApps).map(p => p.replace(/^\/apps\//, '').replace(/\/$/, '').toLowerCase());
      const newPfx  = splitPaths(dp.newApps).map(p => p.replace(/^\/apps\//, '').replace(/\/$/, '').toLowerCase());

      if (oldPfx.length || newPfx.length) {
        let pageJSON = null;
        for (const suffix of ['/jcr:content.infinity.json', '/jcr:content.6.json', '.infinity.json', '.6.json']) {
          const r = await aemFetch(base + contentPath + suffix, auth, { timeout: 15000 });
          if (r.ok) { const j = tryJSON(r.text); if (j && !isRedirectList(j)) { pageJSON = j; break; } }
        }
        if (pageJSON) {
          const allRTs = [];
          collectAllRTs(pageJSON, contentPath + '/jcr:content', allRTs, 0);
          total = allRTs.length;
          for (const { path: p, rt } of allRTs) {
            const norm = rt.toLowerCase();
            if (oldPfx.some(x => norm.startsWith(x))) {
              const newRT = newPfx.length ? norm.replace(oldPfx.find(x => norm.startsWith(x)), newPfx[0]) : '';
              legacy.push({ path: p, rt, label: p.split('/').pop(), modern: newRT, rule: { ruleName: '' }, contentPath: extractPagePath(p), source: 'infinity' });
            } else if (newPfx.some(x => norm.startsWith(x))) {
              converted.push({ path: p, rt, label: p.split('/').pop(), source: 'infinity' });
            }
          }
        }
      }
    }

    // ── Template detection via .template.rules.json ──────────────────
    // Confirmed response: { success, message, paths: [jcr:content path], rules: [{id, title}] }
    // rules = PageRewriteRule OSGi class names that apply to this page's template
    // rules.length > 0 → page uses a legacy static template
    // rules.length === 0 → already using editable template (or no rules apply)
    let templateStatus  = 'unknown';
    let template        = '';
    let pageRT          = '';
    let templateRuleIds = [];

    const tmplUrl  = base
      + '/mnt/overlay/aem-modernize/content/structure/job/create.template.rules.json'
      + '?path=' + encodeURIComponent(contentPath) + '&reprocess=false';

    const tmplResp = await aemFetch(tmplUrl, auth, { timeout: 10000 });
    if (tmplResp.ok) {
      const tr = tryJSON(tmplResp.text);
      if (tr && tr.success) {
        const rules = Array.isArray(tr.rules) ? tr.rules : [];
        templateRuleIds = rules.map(r => r.id).filter(Boolean);
        templateStatus  = rules.length > 0 ? 'legacy' : 'converted';
      }
    }

    // Get cq:template value for display (1.json is lightweight)
    const jcrR = await aemFetch(base + contentPath + '/jcr:content.json', auth, { timeout: 8000 });
    if (jcrR.ok) {
      const jcr = tryJSON(jcrR.text);
      if (jcr) {
        template = (jcr['cq:template'] || '').trim();
        pageRT   = (jcr['sling:resourceType'] || '').trim();
        if (templateStatus === 'unknown' && template) {
          templateStatus = template.includes('/conf/') ? 'converted' : 'legacy';
        }
      }
    }

    return {
      ok:               true,
      contentPath,
      legacy,
      converted,
      total,
      componentRuleIds,            // full rule IDs for use in conversion payload
      templateRuleIds,             // full template rule IDs for use in conversion payload
      componentRuleCount: componentRuleIds.length,
      templateRuleCount:  templateRuleIds.length,
      templateStatus:     { status: templateStatus, template, pageRT },
    };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function splitPaths(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function extractContentPathFromURL(href) {
  if (!href) return null;
  const editor = href.match(/\/editor\.html(\/content\/[^?#"]+?)(?:\.html)?(?:[?#"<]|$)/);
  if (editor) return editor[1];
  const item = href.match(/[?&]item=(\/content\/[^?#&"]+)/);
  if (item) return decodeURIComponent(item[1]).replace(/\.html$/, '');
  const direct = href.match(/^https?:\/\/[^/]+(\/content\/[^?#"]+?)(?:\.html)?(?:[?#]|$)/);
  if (direct) return direct[1];
  return null;
}

function isRedirectList(obj) {
  const keys = Object.keys(obj || {});
  return keys.length > 0
    && keys.every(k => /^\d+$/.test(k))
    && Object.values(obj).every(v => typeof v === 'string' && v.includes('.json'));
}

// Classification priority:
//  1. oldAppsPaths match  → LEGACY  (even if not in rules)
//  2. newAppsPaths match  → CONVERTED (even if not in rules)
//  3. legacyMap rule match → LEGACY
//  4. modernSet rule match → CONVERTED
//  5. everything else     → counted in total only
function walkPageTree(node, path, legacyMap, modernSet, oldAppsPaths, newAppsPaths, legacyOut, convertedOut, allOut, depth) {
  if (depth > 20 || !node || typeof node !== 'object') return;

  const rt = (node['sling:resourceType'] || '').trim();
  if (rt) {
    const norm = rt.toLowerCase();
    allOut.push({ path, rt });

    // Priority 1 & 2: apps path prefix matching
    // sling:resourceType is stored WITHOUT /apps/ prefix in JCR
    // e.g. "corteva-foundation/components/..." not "/apps/corteva-foundation/..."
    // Strip leading /apps/ from configured paths before comparing
    const normRT = norm.startsWith('/') ? norm.slice(1) : norm;
    const isOldApps = oldAppsPaths.length && oldAppsPaths.some(p => {
      const clean = p.toLowerCase().replace(/^\/apps\//, '').replace(/\/$/, '');
      return normRT.startsWith(clean);
    });
    const isNewApps = newAppsPaths.length && newAppsPaths.some(p => {
      const clean = p.toLowerCase().replace(/^\/apps\//, '').replace(/\/$/, '');
      return normRT.startsWith(clean);
    });

    // Priority 3 & 4: rules-based matching
    const rule       = legacyMap.get(norm);
    const isModernRT = modernSet.has(norm);

    if (isOldApps || rule) {
      // LEGACY component
      const modern = rule ? rule.modern : (
        newAppsPaths.length
          ? norm.replace(oldAppsPaths.find(p => norm.startsWith(p.toLowerCase())) || '', newAppsPaths[0])
          : '(no modern equivalent configured)'
      );
      legacyOut.push({
        path,
        rt,
        label:       rule ? (rule.label || rule.ruleName) : rt.split('/').pop(),
        modern,
        category:    rule ? (rule.category || 'content') : inferCategory(rt),
        contentPath: extractPagePath(path),
        source:      isOldApps ? 'apps-path' : 'rule',
      });
    } else if (isNewApps || isModernRT) {
      // CONVERTED component
      const matchedRule = isModernRT ? [...legacyMap.values()].find(r => r.modern.toLowerCase() === norm) : null;
      convertedOut.push({
        path,
        rt,
        label:    matchedRule ? matchedRule.label : rt.split('/').pop(),
        category: matchedRule ? (matchedRule.category || 'content') : inferCategory(rt),
        source:   isNewApps ? 'apps-path' : 'rule',
      });
    }
  }

  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('jcr:') || key.startsWith(':') || key.startsWith('rep:')) continue;
    if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
      walkPageTree(val, path + '/' + key, legacyMap, modernSet, oldAppsPaths, newAppsPaths, legacyOut, convertedOut, allOut, depth + 1);
    }
  }
}

// Extract page-level path from a component path (strip jcr:content and below)
function extractPagePath(path) {
  const match = path.match(/^(\/content\/[^/]+(?:\/[^/]+)*?)(?:\/jcr:content.*)?$/);
  return match ? match[1] : path;
}

// ─────────────────────────────────────────────────────────
// TEST A SPECIFIC PATH (for nav link probing)
// ─────────────────────────────────────────────────────────
async function handleTestPath({ url, user, pass, path }) {
  const auth = makeAuth(user, pass);
  const r    = await aemFetch(url.replace(/\/$/, '') + path, auth, { timeout: 5000 });
  // 200-399 = exists and accessible; 401 = exists but auth issue; 404/5xx = not installed
  return { ok: r.status > 0 && r.status < 400, status: r.status };
}

// ─────────────────────────────────────────────────────────
// FETCH & PARSE RULES  —  fully generic
// ─────────────────────────────────────────────────────────
//
// Handles ALL known AEM Modernize Tools rule structures:
//
// LEGACY type locations:
//   A)  patterns/<child>[ sling:resourceType ]          — most common
//   B)  patterns[ sling:resourceType ]                  — flat single-pattern
//   C)  searchResourceType  (property on rule node)     — old tool format
//   D)  search/<child>[ sling:resourceType ]            — "search" alias
//
// MODERN type locations:
//   A)  replacement/<child>[ sling:resourceType ]       — most common (confirmed)
//   B)  replacement[ sling:resourceType ]               — flat replacement
//   C)  replaceResourceType  (property on rule node)    — old tool format
//   D)  replace/<child>[ sling:resourceType ]           — "replace" alias
//
// Node depth variants:
//   - Rules may be nested 1 or 2 levels under the set path
//   - Per-rule fetch at depth 3 reliably captures all variants
//
async function handleFetchRules({ url, user, pass, rulesPath }) {
  try {
    const auth    = makeAuth(user, pass);
    const base    = url.replace(/\/$/, '');
    const setPath = rulesPath.replace(/\/$/, '');

    // Step 1: list rule names from the set node
    const ruleNames = await listRuleNames(base, setPath, auth);
    if (ruleNames === null) return { ok: false, error: 'HTTP 401 — check credentials' };
    if (!ruleNames.length)  return { ok: false, error: 'No rule nodes found at ' + setPath };

    // Step 2: fetch + parse each rule individually
    const rules = [];
    for (let i = 0; i < ruleNames.length; i += 8) {
      const batch   = ruleNames.slice(i, i + 8);
      const results = await Promise.all(batch.map(n => fetchOneRule(base, setPath, n, auth)));
      for (const r of results) { if (r) rules.push(...r); }
    }

    if (rules.length > 0) {
      return { ok: true, rules, nodeCount: ruleNames.length };
    }

    // Step 3: nothing parsed — show raw sample for diagnosis
    const sample = await aemFetch(base + setPath + '/' + ruleNames[0] + '.3.json', auth);
    return {
      ok: false,
      error: 'Found ' + ruleNames.length + ' rule nodes but could not extract resource type mappings.\n\n'
           + 'First rule ("' + ruleNames[0] + '") raw JSON:\n'
           + (sample.text || '(empty)').slice(0, 700),
    };

  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// List the direct child names of the set node
async function listRuleNames(base, setPath, auth) {
  for (const suffix of ['.1.json', '.2.json', '.json']) {
    const r = await aemFetch(base + setPath + suffix, auth);
    if (r.status === 401) return null;
    if (!r.ok) continue;
    const j = tryJSON(r.text);
    if (!j || is300Redirect(j)) continue;
    // Keep only non-meta keys whose values are objects (real rule nodes)
    const names = Object.keys(j).filter(k => !isMetaKey(k) && typeof j[k] === 'object');
    if (names.length) return names;
  }
  return [];
}

// Fetch one rule node at enough depth to see patterns/* and replacement/*
async function fetchOneRule(base, setPath, ruleName, auth) {
  for (const suffix of ['.3.json', '.4.json', '.2.json']) {
    const r = await aemFetch(base + setPath + '/' + ruleName + suffix, auth);
    if (!r.ok) continue;
    const node = tryJSON(r.text);
    if (!node) continue;
    const rules = extractRule(node, ruleName);
    if (rules && rules.length) return rules;
  }
  return null;
}

// ─────────────────────────────────────────────────────────
// GENERIC RULE EXTRACTOR
// Walks all known structural variants to find legacy→modern pairs
// ─────────────────────────────────────────────────────────
function extractRule(node, ruleName) {

  // ── Collect LEGACY resource types ─────────────────────

  const legacySet = new Set();

  // Variant C: flat property on rule node
  addIfRT(node['searchResourceType'], legacySet);
  addIfRT(node['search'],             legacySet);   // some older rules use this

  // Variants A + B: patterns or search child node
  for (const pKey of ['patterns', 'search']) {
    const pNode = node[pKey];
    if (!pNode || typeof pNode !== 'object') continue;

    // B: RT directly on patterns node
    addIfRT(pNode['sling:resourceType'], legacySet);

    // A: RT on each named child of patterns
    for (const [k, v] of Object.entries(pNode)) {
      if (isMetaKey(k)) continue;
      if (v && typeof v === 'object') addIfRT(v['sling:resourceType'], legacySet);
    }
  }

  if (!legacySet.size) return null;

  // ── Find MODERN resource type ──────────────────────────

  let modernRT = '';

  // Variant C: flat property
  modernRT = strVal(node['replaceResourceType']) || strVal(node['replace']);

  // Variants A + B: replacement or replace child node
  if (!modernRT) {
    for (const rKey of ['replacement', 'replace']) {
      const rNode = node[rKey];
      if (!rNode || typeof rNode !== 'object') continue;

      // B: RT directly on replacement node
      modernRT = strVal(rNode['sling:resourceType']);
      if (modernRT) break;

      // A: RT on first named child of replacement node
      for (const [k, v] of Object.entries(rNode)) {
        if (isMetaKey(k)) continue;
        if (v && typeof v === 'object') {
          modernRT = strVal(v['sling:resourceType']);
          if (modernRT) break;
        }
      }
      if (modernRT) break;
    }
  }

  if (!modernRT) return null;

  // ── Build rule entries ─────────────────────────────────

  const label = strVal(node['jcr:title']) || strVal(node['jcr:description']) || ruleName;
  const rules = [];

  for (const legacy of legacySet) {
    rules.push({
      legacy,
      modern:   modernRT,
      label,
      ruleName,
      category: inferCategory(legacy),
      source:   'var-rule',
    });
  }

  return rules.length ? rules : null;
}

// Add a string as a lowercase resource type if non-empty
function addIfRT(val, set) {
  const s = strVal(val);
  if (s) set.add(s.toLowerCase());
}

function strVal(v) {
  return (typeof v === 'string') ? v.trim() : '';
}

// Map resource type path segments to a UI category
function inferCategory(rt) {
  const s = rt.toLowerCase();
  if (s.includes('form'))                                                            return 'form';
  if (s.includes('page') || s.includes('template'))                                 return 'page';
  if (s.includes('parsys') || s.includes('grid') || s.includes('container') ||
      s.includes('column') || s.includes('layout') || s.includes('iparsys'))        return 'layout';
  if (s.includes('nav') || s.includes('bread') || s.includes('menu') ||
      s.includes('search') || s.includes('sitemap'))                                return 'navigation';
  if (s.includes('image') || s.includes('video') || s.includes('media') ||
      s.includes('gallery') || s.includes('carousel') || s.includes('banner') ||
      s.includes('embed'))                                                           return 'media';
  return 'content';
}

// ─────────────────────────────────────────────────────────
// SUBMIT JOB
// ─────────────────────────────────────────────────────────
// AEMaaCS aem-modernize v2 uses Sling jobs via POST to /var/aem-modernize/<type>/jobs
// AEM 6.x modernize tools use /libs/cq/modernize/api/<type>
// We try both, preferring AEMaaCS paths first.
// Job submission endpoints — tried in order until one succeeds.
// /var/aem-modernize/job-data/full/ is where AEMaaCS stores completed jobs (confirmed from CRXDE).
// Submission goes to the Sling Job queue handler endpoint.
// Job submission endpoints tried in order.
// The AEM Modernize Tools package registers a Sling Job handler.
// Confirmed from job-data URL: /var/aem-modernize/job-data/component/YYYY/MM/DD/jobname
// The submission endpoint is the Sling jobs servlet for that topic.
// ── Job Submission ────────────────────────────────────────
//
// CONFIRMED endpoint from AEM Modernize Tools v2 source & community:
//   POST /mnt/overlay/aem-modernize/content/component/job/create.json
//
// The ScheduleConversionJobServlet uses service user aem-modernize-convert-service
// for ALL JCR writes. The calling user only needs to invoke the servlet.
// Admin can invoke it by default.
//
// The servlet is registered as a Sling servlet on the resource type:
//   "aem-modernize/components/job/create"
// which lives at /mnt/overlay/aem-modernize/content/component/job/create
//
// REQUEST FORMAT (matching exactly what the UI sends):
//   Content-Type: application/x-www-form-urlencoded
//   CSRF-Token: <token>    (required — servlet checks this before service user)
//   Body: name=<title>&paths=<path1>&paths=<path2>
//
// NOTE: The CSRF check happens at the Sling filter level BEFORE the servlet.
// The service user only kicks in INSIDE the servlet. So CSRF must pass first.
// Admin user has sufficient rights to call the servlet itself.

const JOB_CREATE_ENDPOINTS = {
  'component':       '/mnt/overlay/aem-modernize/content/component/job/create.json',
  'page-structure':  '/mnt/overlay/aem-modernize/content/structure/job/create.json',
  'responsive-grid': '/mnt/overlay/aem-modernize/content/responsive-grid/job/create.json',
};

// Get CSRF token — called by popup before injecting fetch into page
async function handleGetCSRFToken({ url, user, pass, devToken }) {
  const auth = makeAuth(user, pass, devToken);
  const base = url.replace(/\/$/, '');
  const token = await fetchCSRFToken(base, auth);
  return { ok: !!token, token };
}

async function fetchCSRFToken(base, auth) {
  const r = await aemFetch(base + '/libs/granite/csrf/token.json', auth, { timeout: 6000 });
  if (r.ok) {
    const j = tryJSON(r.text);
    if (j && j.token) return j.token;
  }
  return null;
}

// Configure the AEM Modernize Tools OSGi services to use the project-specific rules paths.
// This must be done before submitting jobs — otherwise the servlet finds 0 rules for any page
// and returns "Error processing request parameters".
async function configureOSGiRules(base, auth, csrfToken, rulesPath) {
  if (!rulesPath) return;

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (csrfToken) { headers['CSRF-Token'] = csrfToken; headers['X-CSRF-Token'] = csrfToken; }

  // The three OSGi service PIDs that need the rules search path configured
  const configs = [
    {
      pid:   'com.adobe.aem.modernize.component.impl.ComponentRewriteRuleServiceImpl',
      props: { 'search.paths': rulesPath, propertylist: 'search.paths' },
    },
    {
      pid:   'com.adobe.aem.modernize.structure.impl.PageStructureRewriteRuleServiceImpl',
      props: { 'search.paths': rulesPath, propertylist: 'search.paths' },
    },
  ];

  for (const cfg of configs) {
    const body = new URLSearchParams({
      apply:        'true',
      action:       'ajaxConfigManager',
      propertylist: 'search.paths',
      'search.paths': rulesPath,
    });
    if (csrfToken) body.append(':cq_csrf_token', csrfToken);

    try {
      await aemFetch(
        base + '/system/console/configMgr/' + cfg.pid,
        auth,
        { method: 'POST', headers, body: body.toString(), timeout: 8000 }
      );
    } catch (_) { /* non-fatal — continue */ }
  }
}

async function handleSubmitJob({ url, user, pass, devToken, path, tool, recursive, dryRun }) {
  const auth      = makeAuth(user, pass, devToken);
  const base      = url.replace(/\/$/, '');
  const useBearer = !!(devToken && devToken.trim());
  const endpoint  = JOB_CREATE_ENDPOINTS[tool] || JOB_CREATE_ENDPOINTS['component'];

  // CSRF token is always required — it's checked at the Sling filter level
  // before the servlet even runs (and before the service user kicks in).
  // Bearer token bypasses CSRF entirely (token-based auth skips CsrfFilter).
  let csrfToken = null;
  if (!useBearer) {
    csrfToken = await fetchCSRFToken(base, auth);
    if (!csrfToken) {
      return { ok: false, error: 'Could not obtain CSRF token from ' + base + '/libs/granite/csrf/token.json — check server connection' };
    }
  }

  // Build request body — exactly matching the AEM Modernize Tools UI form
  // The servlet accepts: name (job title) + paths[] (content paths to convert)
  const jobName = 'ext-' + Date.now();
  const body    = new URLSearchParams({ name: jobName });
  body.append('paths', path);
  // :cq_csrf_token in body as belt-and-suspenders alongside the header
  if (csrfToken) body.append(':cq_csrf_token', csrfToken);

  // Headers — CSRF token MUST be in the header for the Sling CsrfFilter
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (csrfToken) {
    headers['CSRF-Token']   = csrfToken;  // standard Granite header
    headers['X-CSRF-Token'] = csrfToken;  // some AEM versions use this
  }

  const r = await aemFetch(base + endpoint, auth, {
    method: 'POST', headers, body: body.toString(), timeout: 20000,
  });

  // The servlet returns JSON: { success: true|false, message: "...", job: {...} }
  if (r.status === 200 || r.status === 201) {
    const j = tryJSON(r.text);
    if (j && j.success === false) {
      // Servlet ran but failed internally (e.g. service user mapping issue)
      return {
        ok: false,
        error: 'Job servlet error: ' + (j.message || 'unknown') + '. '
             + 'Check AEM error logs — this is usually a service user mapping issue. '
             + 'Verify the "aem-modernize-convert-service" system user exists in '
             + base + '/crx/de/index.jsp#/home/users/system',
      };
    }
    const jobId = (j && j.job && (j.job['jcr:name'] || j.job.id || j.job.name)) || jobName;
    return { ok: true, jobId, endpoint };
  }

  if (r.status === 403) {
    const body403 = (r.text || '').toLowerCase();
    // Distinguish CSRF failure from permissions failure
    if (body403.includes('csrf') || body403.includes('forbidden token')) {
      return { ok: false, error: 'HTTP 403 — CSRF validation failed. Try adding a Bearer/Dev token in Settings to bypass CSRF.' };
    }
    // Genuine permissions — but this should not happen for admin
    return {
      ok: false,
      error: 'HTTP 403 — Permission denied on ' + endpoint + '. '
           + 'Admin should have access by default. Check AEM error logs for details. '
           + 'Raw: ' + r.text.slice(0, 200),
    };
  }

  if (r.status === 404) {
    return {
      ok: false,
      error: 'HTTP 404 — Servlet not found at ' + endpoint + '. '
           + 'Verify the aem-modernize-tools package is installed and active: '
           + base + '/system/console/bundles (search "aem-modernize")',
    };
  }

  return { ok: false, error: 'HTTP ' + r.status + (r.text ? ' — ' + r.text.slice(0, 300) : '') };
}

// ─────────────────────────────────────────────────────────
// JOB POLLING (background alarm)
// ─────────────────────────────────────────────────────────
async function checkRunningJobs() {
  const { jobs, serverConfig, history } =
    await chrome.storage.local.get(['jobs', 'serverConfig', 'history']);
  if (!jobs || !jobs.length || !serverConfig || !serverConfig.url) return;

  const running = jobs.filter(j => j.status === 'running');
  if (!running.length) return;

  const updated = [...jobs];
  const hist    = history || [];
  let changed   = false;
  const auth    = makeAuth(serverConfig.user, serverConfig.pass);

  for (const job of running) {
    const r = await aemFetch(
      serverConfig.url.replace(/\/$/, '') + (job.statusPath || ('/var/aem-modernize/job-data/full/' + job.id + '.json')),
      auth
    );
    const idx = updated.findIndex(j => j.id === job.id);
    if (idx === -1) continue;
    if (r.ok) {
      const j = tryJSON(r.text);
      if (!j) continue;
      const s = j.status || 'running';
      updated[idx] = Object.assign({}, updated[idx], { status: s, progress: j.progress || 0 });
      if (s === 'success' || s === 'failed') {
        hist.unshift(Object.assign({}, updated[idx], { finishedAt: new Date().toISOString() }));
        updated.splice(idx, 1);
        chrome.notifications.create({
          type: 'basic', iconUrl: 'icons/icon48.png',
          title: 'AEM Modernize Tools',
          message: job.toolName + ': ' + (s === 'success' ? 'Completed ✓' : 'Failed ✗'),
        });
      }
      changed = true;
    }
  }
  if (changed) chrome.storage.local.set({ jobs: updated, history: hist });
}
