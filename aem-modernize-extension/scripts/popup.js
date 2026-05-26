/* AEM Modernize Tools — Popup Script
   External JS file only (MV3 CSP blocks inline scripts)
   All AEM fetches routed through background service worker */

'use strict';

const TOOLS = {
  'page-structure':  { name: 'Page Structure Conversion', defaultPath: '/content' },
  'component':       { name: 'Component Rewriter',        defaultPath: '/apps' },
  'policy':          { name: 'Policy Import',             defaultPath: '/conf' },
  'responsive-grid': { name: 'Responsive Grid Upgrade',   defaultPath: '/content' },
};

// ── Message helper ─────────────────────────────────────────
function bgMsg(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response || {});
      }
    });
  });
}

// ── State ──────────────────────────────────────────────────
let selectedTool = null;
let serverConfig = {};
let jobs         = [];
let jobHistory      = [];

// ── Init ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Clear any legacy stored serverConfig — auto-detect replaces it
  chrome.storage.local.remove(['serverConfig', 'detectionPaths', 'cachedRules']);
  await loadState();
  detectCurrentPage();
  renderServerStrip();
  initTabs();
  initToolCards();
  initRunPanel();
  initHistoryTab();
  initScanBtn();

  // History loads on-demand when tab is clicked
});

// ── Load state from storage ────────────────────────────────
function loadState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['jobHistory', 'lastScanResult'], (data) => {
      jobHistory = data.jobHistory || [];
      resolve();
    });
  });
}

function saveState() {
  chrome.storage.local.set({ jobHistory });
}

// ── Detect current AEM page path from active tab ───────────
function detectCurrentPage() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0] || !tabs[0].url) return;
    try {
      const url = new URL(tabs[0].url);
      const editorMatch  = url.pathname.match(/\/editor\.html(\/content\/[^?#]+)/);
      const contentMatch = url.pathname.match(/^(\/content\/[^?#.]+)/);
      const path = editorMatch ? editorMatch[1] : (contentMatch ? contentMatch[1] : '');
      if (path) {
        const el = document.getElementById('sourcePath');
        if (el && !el.value) el.value = path;
      }
    } catch (_) {}
  });
}

// ── Server strip ───────────────────────────────────────────
async function renderServerStrip() {
  const dot   = document.getElementById('serverDot');
  const label = document.getElementById('serverLabel');
  if (!dot || !label) return;

  // Always auto-detect from active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (tab && tab.url) {
      try {
        const u = new URL(tab.url);
        const isAEM = tab.url.includes('/editor.html/') || tab.url.includes('/sites.html') ||
                       tab.url.includes('.adobeaemcloud.com') ||
                       (u.hostname === 'localhost') || (u.hostname === '127.0.0.1');
        if (isAEM) {
          dot.className    = 'server-dot ok';
          label.textContent = u.host;
          return;
        }
      } catch (_) {}
    }
    dot.className    = 'server-dot';
    label.textContent = 'Open an AEM editor page';
  });
}


// ── Tabs ──────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const content = document.getElementById('tab-' + btn.dataset.tab);
      if (content) content.classList.add('active');
      if (btn.dataset.tab === 'jobs')    renderJobs();
      if (btn.dataset.tab === 'history') loadAndRenderHistory();
    });
  });
}

// ── Tool cards ────────────────────────────────────────────
function initToolCards() {
  document.querySelectorAll('.tool-card').forEach((card) => {
    card.addEventListener('click', () => {
      const toolKey = card.dataset.tool;

      if (selectedTool === toolKey) {
        // Toggle off
        selectedTool = null;
        card.classList.remove('active');
        const panel = document.getElementById('runPanel');
        if (panel) panel.style.display = 'none';
        return;
      }

      selectedTool = toolKey;
      document.querySelectorAll('.tool-card').forEach((c) => c.classList.remove('active'));
      card.classList.add('active');

      const tool      = TOOLS[toolKey];
      const titleEl   = document.getElementById('runPanelTitle');
      const pathEl    = document.getElementById('sourcePath');
      const panel     = document.getElementById('runPanel');
      const statusEl  = document.getElementById('runStatus');

      if (titleEl) titleEl.textContent = tool.name;
      if (pathEl && !pathEl.value) pathEl.value = tool.defaultPath;
      if (statusEl) { statusEl.className = 'run-status'; statusEl.textContent = ''; }
      if (panel) {
        panel.style.display = 'flex';
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });
}

// ── Run panel ─────────────────────────────────────────────
function initRunPanel() {
  const closeBtn = document.getElementById('closePanelBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      selectedTool = null;
      document.querySelectorAll('.tool-card').forEach((c) => c.classList.remove('active'));
      const panel = document.getElementById('runPanel');
      if (panel) panel.style.display = 'none';
    });
  }

  const useCurrentBtn = document.getElementById('useCurrentBtn');
  if (useCurrentBtn) {
    useCurrentBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        try {
          const url = new URL(tabs[0].url);
          const em  = url.pathname.match(/\/editor\.html(\/content\/[^?#]+)/);
          const cm  = url.pathname.match(/^(\/content\/[^?#.]+)/);
          const path = em ? em[1] : (cm ? cm[1] : url.pathname);
          const el = document.getElementById('sourcePath');
          if (el) el.value = path;
          showToast('Using current page path', 'success');
        } catch (_) {
          showToast('Could not get current page', 'error');
        }
      });
    });
  }

  const runBtn = document.getElementById('runBtn');
  if (runBtn) runBtn.addEventListener('click', handleRun);
}

async function handleRun() {
  if (!selectedTool) return;

  const pathEl    = document.getElementById('sourcePath');
  const path      = pathEl ? pathEl.value.trim() : '';
  const statusEl  = document.getElementById('runStatus');
  const btn       = document.getElementById('runBtn');
  const btnText   = document.getElementById('runBtnText');

  if (!path) { showToast('Enter a source path', 'error'); return; }
  // Loading state
  if (btn)     btn.classList.add('loading');
  if (btnText) btnText.textContent = 'Starting…';
  if (statusEl) { statusEl.className = 'run-status'; statusEl.textContent = ''; }

  try {
    const result = await bgMsg('SUBMIT_JOB', {
      url: '', user: '', pass: '', devToken: '',
      path,
      tool:      selectedTool,
      recursive: document.getElementById('optRecursive')?.checked || false,

    });

    if (!result.ok) {
      if (result.error && result.error.includes('404')) {
        throw new Error('AEM Modernize Tools not installed at the expected path. Check that the package is installed on your server.');
      }
      throw new Error(result.error || 'Job submission failed');
    }

    const job = {
      id:         result.jobId,
      statusPath: result.statusPath || null,
      endpoint:   result.endpoint   || null,
      tool:       selectedTool,
      toolName:   TOOLS[selectedTool].name,
      path,
      status:     'running',
      progress:   0,
      startedAt:  new Date().toISOString(),
    };
    jobs.unshift(job);
    saveState();

    if (statusEl) {
      statusEl.textContent = '✓ Job submitted — ID: ' + result.jobId;
      statusEl.className = 'run-status show ok';
    }
    showToast('Job started!', 'success');

  } catch (err) {
    if (statusEl) {
      statusEl.textContent = '✗ ' + err.message;
      statusEl.className = 'run-status show err';
    }
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (btn)     btn.classList.remove('loading');
    if (btnText) btnText.textContent = 'Run Conversion';
  }
}

function initNavLinks() {
  probeNavLinks().then(renderNavLinks);
}

async function probeNavLinks() {
  const results = [];
  await Promise.all(TOOL_PROBES.map(async (tool) => {
    for (const path of tool.candidates) {
      try {
        const base2  = tabs2 && tabs2[0] ? new URL(tabs2[0].url).origin : '';
  const result = await bgMsg('TEST_PATH', { url: base2, user: '', pass: '', path });
        if (result && result.ok) {
          results.push({ label: tool.label, path, installed: true });
          return;
        }
      } catch (_) {}
    }
    // None of the candidates worked — show as not found
    results.push({ label: tool.label, path: tool.candidates[0], installed: false });
  }));
  return results;
}

function renderNavLinks(links) {
  const list = document.getElementById('navLinkList');
  if (!list) return;



  if (!links.length) {
    list.innerHTML = '<div class="nav-link-loading">Checking…</div>';
    return;
  }

  list.innerHTML = links.map(({ label, path, installed }) => {
    if (installed) {
      return `<button class="nav-link-btn" data-path="${esc(path)}">
        <span>${esc(label)}</span>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="nav-link-tag ok">installed</span>
          <span class="link-ext">↗</span>
        </div>
      </button>`;
    }
    return `<div class="nav-link-unavailable">
      <span>${esc(label)}</span>
      <span class="nav-link-tag">not found</span>
    </div>`;
  }).join('');

  // Bind clicks on newly rendered buttons
  list.querySelectorAll('.nav-link-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (navTabs) => {
        const navBase = navTabs && navTabs[0] ? new URL(navTabs[0].url).origin : '';
        chrome.tabs.create({ url: navBase + btn.dataset.path });
      });
      return;
      const url = ''; // unreachable — kept for structure
      chrome.tabs.create({ url });
    });
  });
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Jobs tab removed

// ── History tab — reads live from AEM JCR ─────────────────
// Job data paths confirmed from CRXDE:
//   /var/aem-modernize/job-data/component/YYYY/
//   /var/aem-modernize/job-data/structure/YYYY/
//   /var/aem-modernize/job-data/full/YYYY/
// Job detail page: /mnt/overlay/aem-modernize/content/component/job/view.html/<jobDataPath>

const JOB_DATA_PATHS = [
  { path: '/var/aem-modernize/job-data/component', label: 'Component',   viewBase: '/mnt/overlay/aem-modernize/content/component/job/view.html' },
  { path: '/var/aem-modernize/job-data/structure', label: 'Page Structure', viewBase: '/mnt/overlay/aem-modernize/content/structure/job/view.html' },
  { path: '/var/aem-modernize/job-data/full',      label: 'Full',        viewBase: '/mnt/overlay/aem-modernize/content/full/job/view.html' },
];

let allHistoryJobs  = [];   // cache from last fetch
let activeHistType  = 'all'; // current sub-tab filter

function initHistoryTab() {
  const refreshBtn = document.getElementById('refreshHistBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadAndRenderHistory);

  // Sub-tab filter buttons
  document.querySelectorAll('.hist-type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.hist-type-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeHistType = btn.dataset.type;
      renderHistory(allHistoryJobs);
    });
  });

  // Auto-load when main History tab clicked
  document.querySelectorAll('.tab').forEach(tab => {
    if (tab.dataset.tab === 'history') {
      tab.addEventListener('click', loadAndRenderHistory);
    }
  });
}

async function loadAndRenderHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;

  // Get active AEM tab — must inject fetch into page context for session cookies
  const histTabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
  const histTab  = histTabs && histTabs[0];
  if (!histTab || !histTab.url) {
    list.innerHTML = emptyStateHTML('No AEM page open', 'Navigate to an AEM editor page first');
    return;
  }

  let base = '';
  try { base = new URL(histTab.url).origin; } catch (_) {}
  if (!base) {
    list.innerHTML = emptyStateHTML('No AEM page open', 'Navigate to an AEM editor page first');
    return;
  }

  list.innerHTML = '<div class="history-loading">Loading jobs from AEM…</div>';

  try {
    // Inject fetch into the AEM tab so session cookies are sent automatically
    const results = await chrome.scripting.executeScript({
      target: { tabId: histTab.id },
      func: async (base, jobDataPaths) => {
        // Fetch deeply enough to cover year/month/day/job — use 5.json depth
        // Cache-bust with timestamp to always get fresh data
        const cb = '?_=' + Date.now();
        const allJobs = [];

        // Walk the JCR tree: /var/aem-modernize/job-data/<type>/<year>/<month>/<day>/<jobName>
        // pathParts starts as ['/var/aem-modernize/job-data/<type>'] = length 1
        // After walking: year(2), month(3), day(4), jobName(5) → job node at depth 5
        function walkJobs(node, pathParts, label, viewBase) {
          if (!node || typeof node !== 'object') return;
          for (const [key, val] of Object.entries(node)) {
            if (key.startsWith('jcr:') || key.startsWith(':') || key === 'rep:policy') continue;
            if (typeof val !== 'object' || val === null) continue;
            const newParts = [...pathParts, key];
            // depth 5 = type/year/month/day/jobName → this IS a job node
            if (newParts.length === 5) {
              const jobPath = newParts.join('/');
              allJobs.push({
                name:      val['jcr:title'] || val.name || key,
                jobPath,
                label,
                viewUrl:   base + viewBase + jobPath,
                startedAt: val['jcr:created'] || val.startTime || '',
                status:    'completed',
              });
            } else {
              walkJobs(val, newParts, label, viewBase);
            }
          }
        }

        for (const { path, label, viewBase } of jobDataPaths) {
          try {
            // Fetch 5 levels deep: type/year/month/day/job — all in one request
            const r = await fetch(base + path + '.5.json' + cb, { cache: 'no-store' });
            if (!r.ok) continue;
            const tree = await r.json();
            walkJobs(tree, [path], label, viewBase); // path = 1 element, jobs at depth 5
          } catch (_) {}
        }

        // Sort newest first using jobPath as reliable tie-breaker
        // jobPath contains YYYY/MM/DD/jobName which sorts lexicographically = chronologically
        allJobs.sort((a, b) => b.jobPath.localeCompare(a.jobPath));
        return allJobs.slice(0, 100);
      },
      args: [base, JOB_DATA_PATHS],
    });

    const jobs = results && results[0] && results[0].result || [];
    renderHistory(jobs);
  } catch (e) {
    list.innerHTML = emptyStateHTML('Could not load jobs', e.message);
  }
}

// fetchAEMJobs kept for backward compat but history now uses executeScript above
async function fetchAEMJobs(histBase) { return []; }

function deriveJobStatus(node) {
  // AEM Modernize Tools stores job state in child nodes
  // A job with all paths having 'status' = 'SUCCESS' is completed
  // We check the jcr:primaryType and any status hints
  const keys = Object.keys(node);
  const hasPaths = keys.some(k => !k.startsWith('jcr:') && !k.startsWith(':'));
  if (!hasPaths) return 'running';
  // If any child has a status property
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('jcr:') || k.startsWith(':')) continue;
    if (v && typeof v === 'object' && v.status) {
      return v.status.toLowerCase().includes('success') ? 'completed' : 'failed';
    }
  }
  return 'completed';
}

function renderHistory(jobs) {
  // Cache for sub-tab filtering
  if (jobs) allHistoryJobs = jobs;
  const list = document.getElementById('historyList');
  if (!list) return;

  // Filter by active sub-tab
  const typeMap = { component: 'Component', structure: 'Page Structure', full: 'Full' };
  const filtered = activeHistType === 'all'
    ? allHistoryJobs
    : allHistoryJobs.filter(j => j.label && j.label.toLowerCase() === (activeHistType === 'structure' ? 'page structure' : activeHistType));



  if (!filtered.length) {
    const msg = activeHistType === 'all' ? 'No jobs found' : 'No ' + (typeMap[activeHistType] || activeHistType) + ' jobs';
    list.innerHTML = emptyStateHTML(msg, 'Run a conversion to see job history here');
    return;
  }

  list.innerHTML = filtered.map((j) => {
    const statusClass = j.status === 'completed' ? 'completed' : j.status === 'failed' ? 'failed' : 'running';
    const typeBadge   = j.label === 'Component' ? 'hist-badge-comp'
                      : j.label === 'Page Structure' ? 'hist-badge-struct'
                      : j.label === 'Full' ? 'hist-badge-full' : '';
    return '<div class="history-card" data-view-url="' + esc(j.viewUrl) + '" title="Click to view job details">'
      + '<div class="history-icon ' + statusClass + '"></div>'
      + '<div class="history-info">'
      + '<span class="history-type"><span class="hist-badge ' + typeBadge + '">' + esc(j.label) + '</span> ' + esc(j.name) + '</span>'
      + '<span class="history-path" title="' + esc(j.jobPath) + '">' + esc(j.jobPath) + '</span>'
      + '</div>'
      + '<span class="history-time">' + fmtTime(j.startedAt) + '</span>'
      + '</div>';
  }).join('');

  list.querySelectorAll('.history-card[data-view-url]').forEach(card => {
    card.addEventListener('click', () => {
      chrome.tabs.create({ url: card.dataset.viewUrl });
    });
  });
}

// ── Helpers ───────────────────────────────────────────────
function emptyStateHTML(title, sub) {
  return '<div class="empty-state">'
    + '<div class="empty-icon">◎</div>'
    + '<div class="empty-text">' + esc(title) + '</div>'
    + '<div class="empty-sub">' + esc(sub) + '</div>'
    + '</div>';
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  setTimeout(() => { t.classList.remove('show'); }, 2200);
}

function fmtTime(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ago';
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


// ── Scan Page ─────────────────────────────────────────────
function initScanBtn() {
  const btn = document.getElementById('scanBtn');
  if (btn) btn.addEventListener('click', triggerScan);
}

async function triggerScan() {
  const btn     = document.getElementById('scanBtn');
  const title   = document.getElementById('scanTitle');
  const sub     = document.getElementById('scanSub');
  const results = document.getElementById('scanResults');

  // Loading state
  if (btn) { btn.textContent = '↻ Scanning…'; btn.classList.add('scanning'); }
  if (results) results.style.display = 'none';

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab');

    // Inject scan trigger into the page — sends SCAN_PAGE message to content script
    // If content script isn't loaded yet, inject it first
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.__aemModernizeAgentLoaded = false; // allow re-run
        }
      });
    } catch (_) {}

    // Ask background to do the JCR scan directly (most reliable — avoids iframe issues)
    const result = await bgMsg('SCAN_PAGE', {
      url: '', user: '', pass: '', devToken: '',
      pageUrl:  tab.url,
    });

    if (btn) { btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 4v3l2 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Scan Page'; btn.classList.remove('scanning'); }

    if (!result.ok) {
      showToast(result.error || 'Scan failed', 'error');
      if (sub) sub.textContent = '✗ ' + (result.error || 'Scan failed');
      return;
    }

    renderScanResults(result);

  } catch (e) {
    if (btn) { btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M7 4v3l2 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Scan Page'; btn.classList.remove('scanning'); }
    showToast('Scan error: ' + e.message, 'error');
  }
}

// Store last scan result for conversion actions
let lastScanResult = null;

function renderScanResults(result) {
  lastScanResult = result;
  // Persist to storage so it survives popup close/reopen
  chrome.storage.local.set({ lastScanResult: result });
  const results = document.getElementById('scanResults');
  const sub     = document.getElementById('scanSub');
  if (!results) return;

  const legacy         = result.legacy    || [];
  const converted      = result.converted || [];
  const template       = result.templateStatus || {};
  const pagePath       = result.contentPath || '';
  const total          = result.total              || 0;
  const compRuleCount  = result.componentRuleCount || 0;
  const tmplRuleCount  = result.templateRuleCount  || 0;

  // Sub-label
  if (sub) sub.textContent = legacy.length + ' components · ' + compRuleCount + ' rules matched';

  // Environment context — from scan result's base URL
  const envServer = document.getElementById('scanEnvServer');
  const envPage   = document.getElementById('scanEnvPage');
  if (envServer) {
    // Read host from active tab URL — most reliable source
    chrome.tabs.query({ active: true, currentWindow: true }, (envTabs) => {
      try {
        const envHost = envTabs && envTabs[0] ? new URL(envTabs[0].url).host : '—';
        envServer.textContent = envHost;
        envServer.title = envHost;
      } catch (_) { envServer.textContent = '—'; }
    });
  }
  if (envPage && result.contentPath) {
    const parts = result.contentPath.split('/').filter(Boolean);
    envPage.textContent = parts.length > 2 ? '…/' + parts.slice(-2).join('/') : result.contentPath;
    envPage.title = result.contentPath;
  }

  // Counts — component count + rule count
  setInner('srLegacy',    legacy.length);
  setInner('srRules',     compRuleCount);
  setInner('srTmplRules', tmplRuleCount);

  // Template badge
  const tmplEl = document.getElementById('srTemplate');
  if (tmplEl) {
    if (template.status === 'converted') {
      tmplEl.textContent = 'Editable ✓';
      tmplEl.className   = 'scan-result-badge ok';
    } else if (template.status === 'legacy') {
      tmplEl.textContent = 'Static (legacy) · ' + tmplRuleCount + ' rules';
      tmplEl.className   = 'scan-result-badge warn';
    } else {
      tmplEl.textContent = 'Unknown';
      tmplEl.className   = 'scan-result-badge dim';
    }
  }

  // ── Conversion Actions ─────────────────────────────────
  const convActions   = document.getElementById('convActions');
  const pageNeedsConv = template.status === 'legacy' || template.status === 'unknown';
  const compNeedsConv = legacy.length > 0;
  const fullNeedsConv = pageNeedsConv || compNeedsConv;

  if (convActions && pagePath) {
    // Full conversion row — active when either page or component needs conversion
    const fullRow  = document.getElementById('convFullRow');
    const fullDesc = document.getElementById('convFullDesc');
    if (fullRow) {
      if (!fullNeedsConv) {
        fullRow.classList.add('disabled');
        if (fullDesc) fullDesc.textContent = 'Page and components already converted ✓';
      } else {
        fullRow.classList.remove('disabled');
        const parts = [];
        if (pageNeedsConv) parts.push('template');
        if (compNeedsConv) parts.push(legacy.length + ' components');
        if (fullDesc) fullDesc.textContent = 'Convert ' + parts.join(' + ');
      }
    }

    // Show/dim page conversion row based on template status
    const pageRow = document.getElementById('convPageRow');
    if (pageRow) {
      if (template.status === 'converted') {
        pageRow.classList.add('disabled');
        pageRow.querySelector('.conv-action-desc').textContent = 'Already using editable template ✓';
      } else {
        pageRow.classList.remove('disabled');
        pageRow.querySelector('.conv-action-desc').textContent =
          template.template ? shortPath(template.template) : 'Convert legacy template → editable template';
      }
    }

    // Show/dim component row
    const compRow = document.getElementById('convCompRow');
    const compDesc = document.getElementById('convCompDesc');
    if (compRow) {
      if (!compNeedsConv && converted.length > 0) {
        compRow.classList.add('disabled');
        if (compDesc) compDesc.textContent = 'All ' + converted.length + ' components already converted ✓';
      } else if (!compNeedsConv) {
        compRow.classList.add('disabled');
        if (compDesc) compDesc.textContent = 'No legacy components detected ✓';
      } else {
        compRow.classList.remove('disabled');
        if (compDesc) compDesc.textContent = legacy.length + ' legacy component' + (legacy.length !== 1 ? 's' : '') + ' detected';
      }
    }

    convActions.style.display = 'flex';
    bindConversionActions(pagePath, legacy);
  } else if (convActions) {
    convActions.style.display = 'none';
  }

  // ── Legacy component list ──────────────────────────────
  const list = document.getElementById('srLegacyList');
  if (list) {
    if (!legacy.length) {
      if (converted.length > 0) {
        list.innerHTML = '<div style="font-size:10px;color:#22d3a0;padding:6px 2px">✓ All components on this page are converted</div>';
      } else if (result.debug && result.debug.uniqueRTSample && result.debug.uniqueRTSample.length) {
        // Show debug: what RTs were actually found vs what prefixes we're matching against
        const d = result.debug;
        list.innerHTML = '<div style="font-size:9px;color:#f59e0b;padding:4px 2px;line-height:1.6">'
          + '⚠ No matches found. '
          + (d.totalNodes ? d.totalNodes + ' nodes scanned. ' : '')
          + '</div>'
          + '<div style="font-size:9px;color:#4a5878;padding:2px 0 2px 2px">Configured old prefix: <span style="color:#f56565">'
          + esc((result.debug.oldAppsPrefixes || []).join(', ') || '(none set)')
          + '</span></div>'
          + '<div style="font-size:9px;color:#4a5878;padding:2px 0 4px 2px">Configured new prefix: <span style="color:#22d3a0">'
          + esc((result.debug.newAppsPrefixes || []).join(', ') || '(none set)')
          + '</span></div>'
          + '<div style="font-size:9px;color:#4a5878;padding:2px 0 2px 2px">Sample RTs found on page:</div>'
          + d.uniqueRTSample.map(rt =>
              '<div style="font-size:9px;color:#4f9eff;padding:2px 6px;background:#111827;border-radius:3px;margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(rt) + '">'
              + esc(rt) + '</div>'
            ).join('')
          + '<div style="font-size:9px;color:#4a5878;margin-top:4px">→ Check that your old/new apps paths in Settings match the prefix of these RTs</div>';
      } else {
        list.innerHTML = '<div style="font-size:10px;color:#4a5878;padding:6px 2px">No components found — check server connection and page path</div>';
      }
    } else {
      const SHOW = 12;
      list.innerHTML = legacy.slice(0, SHOW).map(f => `
        <div class="sr-legacy-item">
          <div class="sr-legacy-item-left">
            <span class="sr-legacy-name">${esc(f.label || f.rt.split('/').pop())}</span>
            <span class="sr-legacy-path" title="${esc(f.rt)}">${esc(shortRT(f.rt))}</span>
          </div>
          <span class="sr-legacy-arrow">→</span>
          <span class="sr-legacy-modern" title="${esc(f.modern || '')}">${esc(shortRT(f.modern || ''))}</span>
        </div>`).join('');
      if (legacy.length > SHOW) {
        list.innerHTML += `<div style="font-size:9px;color:#4a5878;padding:3px 4px">+${legacy.length - SHOW} more legacy components</div>`;
      }
    }
  }

  results.style.display = 'flex';
}

function bindConversionActions(pagePath, legacyComponents) {
  const btnPage = document.getElementById('btnConvPage');
  const btnComp = document.getElementById('btnConvComp');

  // Remove old listeners by cloning
  if (btnPage) {
    const p = btnPage.cloneNode(true);
    btnPage.parentNode.replaceChild(p, btnPage);
    p.addEventListener('click', () => runConversion('page-structure', pagePath, p));
  }
  if (btnComp) {
    const c = btnComp.cloneNode(true);
    btnComp.parentNode.replaceChild(c, btnComp);
    c.addEventListener('click', () => runConversion('component', pagePath, c));
  }
}

async function runConversion(tool, pagePath, btn) {
  // url resolved via auto-detect in triggerScan — should always be set by here
  if (!pagePath)          { showToast('No page path detected', 'error'); return; }

  const statusEl = document.getElementById('convStatus');

  const origText = btn.textContent;
  btn.textContent = '…';
  btn.classList.add('running');

  if (statusEl) {
    statusEl.textContent = 'Running conversion…';
    statusEl.className   = 'conv-status info';
    statusEl.style.display = 'block';
  }

  try {
    // Inject the fetch into the active tab so it runs with the page's Referer header.
    // This bypasses the Felix CSRF/Referer check that blocks requests from the extension background.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let result;

    if (tab && tab.url) {
      result = await injectConversionFetch(tab.id, {}, pagePath, tool);
    } else {
      // Fallback to background worker
      result = await bgMsg('SUBMIT_JOB', {
        url: '', user: '', pass: '', devToken: '',
        path:     pagePath,
        tool,
        recursive: false,
      });
    }

    btn.classList.remove('running');

    if (result.ok) {
      btn.textContent = '✓ Done';
      btn.classList.add('done');

      // Save to jobHistory
      jobHistory.unshift({
        id:         result.jobId || ('local-' + Date.now()),
        tool,
        toolName:   tool === 'page-structure' ? 'Page Structure Conversion' : tool === 'full' ? 'Full Conversion' : 'Component Conversion',
        path:       pagePath,
        status:     'completed',
        startedAt:  new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
      if (jobHistory.length > 50) jobHistory = jobHistory.slice(0, 50);
      saveState();

      if (statusEl) {
        statusEl.textContent = '✓ Job submitted — ID: ' + result.jobId;
        statusEl.className   = 'conv-status ok';
        statusEl.style.display = 'block';
      }
      showToast('Job submitted!', 'success');
    } else {
      btn.textContent = origText;
      btn.classList.add('failed');
      setTimeout(() => { btn.classList.remove('failed'); btn.textContent = origText; }, 3000);

      if (statusEl) {
        // Show full error — may contain AEM CSRF config instructions
        statusEl.style.whiteSpace = 'pre-wrap';
        statusEl.style.fontSize   = '10px';
        statusEl.style.display    = 'block';
        statusEl.textContent      = '✗ ' + (result.error || 'Unknown error');
        statusEl.className        = 'conv-status err';
      }
      showToast('Failed: ' + (result.error || '').slice(0, 60), 'error');
    }
  } catch (e) {
    btn.classList.remove('running');
    btn.textContent = origText;
    if (statusEl) {
      statusEl.textContent = '✗ Error: ' + e.message;
      statusEl.className = 'conv-status err';
    }
    showToast('Error: ' + e.message, 'error');
  }
}

function shortRT(rt) {
  if (!rt) return '';
  const parts = rt.split('/');
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : rt;
}

function setInner(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function shortPath(p) {
  if (!p) return '';
  const parts = p.split('/');
  return parts.length > 4 ? '…/' + parts.slice(-2).join('/') : p;
}

// ── Inject conversion fetch into the AEM page ─────────────
// Runs in the page context so the browser automatically sets the correct
// Referer header, bypassing Felix/Sling CSRF restrictions.
async function injectConversionFetch(tabId, sc, pagePath, tool) {
  const ENDPOINTS = {
    'component':       '/mnt/overlay/aem-modernize/content/component/job/create.json',
    'page-structure':  '/mnt/overlay/aem-modernize/content/structure/job/create.json',
    'responsive-grid': '/mnt/overlay/aem-modernize/content/responsive-grid/job/create.json',
    'full':            '/mnt/overlay/aem-modernize/content/full/job/create.json',
  };
  const endpoint = ENDPOINTS[tool] || ENDPOINTS['component'];

  // Auto-detect base URL from active tab if not configured in settings
  let base = sc.url ? sc.url.replace(/\/$/, '') : null;
  if (!base) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0] && tabs[0].url) {
        base = new URL(tabs[0].url).origin;
      }
    } catch (_) {}
  }
  if (!base) return { ok: false, error: 'Could not determine AEM server URL' };

  // Use explicit credentials if configured, otherwise null = browser session cookies
  const creds = (sc.user || sc.pass)
    ? 'Basic ' + btoa((sc.user || 'admin') + ':' + (sc.pass || 'admin'))
    : null;

  try {
    // executeScript injects a function into the page — runs with page origin/Referer
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (base, endpoint, creds, devToken, pagePath, compRuleIds, tmplRuleIds, compPaths, tool) => {
        try {
          // Auth header: Bearer > Basic > null (session cookies from browser)
          // When null, the browser automatically sends AEM session cookies since
          // this code runs in the page context (same origin as AEM)
          const auth = devToken ? 'Bearer ' + devToken : creds || null;

          // CSRF token — runs in page context so Referer header is correct
          // Session cookie auth: CSRF still required; Bearer auth: CSRF skipped
          let csrf = '';
          if (!devToken) {
            const ctHeaders = auth ? { Authorization: auth } : {};
            const ct = await fetch(base + '/libs/granite/csrf/token.json', {
              headers: ctHeaders,
              credentials: 'include', // send session cookies
            });
            if (ct.ok) { const cj = await ct.json(); csrf = cj.token || ''; }
          }

          const headers = {
            ...(auth ? { Authorization: auth } : {}), // omit header entirely for cookie session
            'CSRF-Token':   csrf,
            'X-CSRF-Token': csrf,
            'Content-Type': 'application/x-www-form-urlencoded',
          };

          const jobName = 'ext-' + Date.now();
          // Full conversion = STRUCTURE + COMPONENT in one job (type: "FULL")
          const dataObj = tool === 'page-structure'
            ? {
                name: jobName, type: 'STRUCTURE',
                paths:          [pagePath],
                templateRules:  tmplRuleIds  || [],
                policyRules:    [],
                componentRules: [],
                overwrite: false, sourceRoot: '', targetRoot: '', pageHandling: 'NONE',
              }
            : tool === 'full'
            ? {
                name: jobName, type: 'FULL',
                paths:          [pagePath],   // page path only, not component paths
                templateRules:  tmplRuleIds  || [],
                policyRules:    [],
                componentRules: compRuleIds  || [],
                overwrite: false, sourceRoot: '', targetRoot: '', pageHandling: 'NONE',
              }
            : {
                name: jobName, type: 'COMPONENT',
                paths:          (compPaths && compPaths.length) ? compPaths : [pagePath + '/jcr:content'],
                templateRules:  [],
                policyRules:    [],
                componentRules: compRuleIds || [],
                overwrite: false,
              };

          const body = new URLSearchParams({ data: JSON.stringify(dataObj) });
          if (csrf) body.append(':cq_csrf_token', csrf);

          const r    = await fetch(base + endpoint, { method: 'POST', headers, body: body.toString(), credentials: 'include' });
          const text = await r.text();
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          // Pass jobName so caller can use it as ID if response has none
          return { ok: r.ok, status: r.status, text, json, jobName: dataObj.name };

        } catch (e) {
          return { ok: false, status: 0, text: e.message, json: null };
        }
      },
      args: [
        base, endpoint, creds, sc.devToken || '', pagePath,
        (lastScanResult || {}).componentRuleIds || [],
        (lastScanResult || {}).templateRuleIds  || [],
        lastScanResult && lastScanResult.legacy
          ? [...new Set(lastScanResult.legacy.map(f => f.path).filter(Boolean))]
          : [],
        tool,
      ],
    });
    const res = results && results[0] && results[0].result;
    if (!res) return { ok: false, error: 'Script injection failed' };

    if (res.ok) {
      const j     = res.json;
      if (j && j.success === false) {
        return { ok: false, error: 'AEM error: ' + (j.message || 'unknown') };
      }
      const jobId = (j && j.job && (j.job['jcr:name'] || j.job.id)) || ('local-' + Date.now());
      return { ok: true, jobId };
    }

    if (res.status === 403) {
      return { ok: false, error: 'HTTP 403 — ' + (res.text ? res.text.slice(0, 200) : 'Forbidden') };
    }
    return { ok: false, error: 'HTTP ' + res.status + ' — ' + (res.text || '').slice(0, 200) };

  } catch (e) {
    // scripting.executeScript can fail if tab is not injectable
    // Fall back to background worker
    return await bgMsg('SUBMIT_JOB', {
      url: sc.url, user: sc.user, pass: sc.pass, devToken: sc.devToken || '',
      path: pagePath, tool, recursive: false,
    });
  }
}
