# AEM Modernize Tools — Chrome Extension

A Chrome extension that brings the power of [AEM Modernize Tools](https://opensource.adobe.com/aem-modernize-tools/) directly into your browser. Scan any AEM page for legacy components and static templates, then trigger component conversion and page structure conversion jobs without leaving the editor.

---

## Features

- **Auto-scan AEM pages** — detects legacy components and static templates using native AEM Modernize Tools endpoints
- **Floating agent panel** — appears on every AEM editor page with real-time component counts, rule counts, and conversion status
- **Popup scan** — manually scan the current page and see results in the extension popup
- **One-click conversion** — trigger Component Conversion and Page Structure conversion jobs directly from the browser
- **Job history** — view past conversion jobs fetched live from `/var/aem-modernize/job-data/`
- **Click to view job details** — click any history entry to open the AEM job detail page
- **Light theme UI** — clean, professional design consistent across popup and floating panel
- **Works with local Cloud SDK and AEMaaCS** — Bearer token support for cloud environments

---

## Screenshots

| Popup — Scan Results | Floating Agent Panel |
|---|---|
| Components to Convert, Matching Rules, Template status | SERVER / PAGE context, COMPONENTS / COMP RULES / TMPL RULES counts |

---

## Installation

### From source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `aem-modernize-extension` folder
6. The extension icon appears in your Chrome toolbar

---

## Configuration

Click the **⚙ gear icon** in the popup (or right-click the extension → Options) to open Settings.

### Server Connection

| Field | Description |
|---|---|
| **AEM Author URL** | Your AEM Author instance, e.g. `http://localhost:4502` — no trailing slash |
| **Username** | AEM username — default `admin` for local |
| **Password** | AEM password — default `admin` for local |
| **Developer / Bearer Token** | IMS Bearer token for AEMaaCS cloud environments (recommended) — bypasses CSRF entirely |

### Auth Modes

| Environment | Recommended Auth |
|---|---|
| Local AEM (localhost) | Basic Auth — `admin / admin`, CSRF skipped automatically |
| AEM as a Cloud Service | Bearer/Dev Token — obtain from AEM Developer Console |
| AEM 6.5 on-prem | Basic Auth with your credentials |

**To get a Bearer token on AEMaaCS:**
1. Go to your AEM environment → Developer Console
2. Navigate to the **Integrations** tab
3. Click **Get Local Development Token** and copy the access token

---

## How It Works

### Detection (Zero Configuration)

The extension uses **AEM Modernize Tools native endpoints** — no manual path configuration required:

| What | Endpoint | Returns |
|---|---|---|
| Component scan | `.component.rules.json?path=<page>&reprocess=false` | `{success, paths:[compPaths], rules:[{id, title}]}` |
| Template status | `.template.rules.json?path=<page>&reprocess=false` | `{success, paths, rules:[{id:"com.corteva...Rule~name", title}]}` |

- If `rules.length > 0` → page has **legacy components / static template** needing conversion
- If `rules.length === 0` → already using modern components / editable template

### Conversion

Conversion jobs are submitted to the AEM Modernize Tools servlet:

```
POST /mnt/overlay/aem-modernize/content/component/job/create.json
POST /mnt/overlay/aem-modernize/content/structure/job/create.json
```

**Payload format** (confirmed from AEM Modernize Tools UI network trace):

```json
{
  "name": "ext-1234567890",
  "type": "COMPONENT",
  "paths": ["/content/site/page/jcr:content/root/container/..."],
  "componentRules": ["/var/componentconversion/set/rule1", "/var/componentconversion/set/rule2"],
  "templateRules": [],
  "policyRules": [],
  "overwrite": false
}
```

For Page Structure:
```json
{
  "name": "ext-1234567890",
  "type": "STRUCTURE",
  "paths": ["/content/site/page"],
  "templateRules": ["com.corteva.foundation.core.services.impl.CortevaFoundationPageRewriteRule~page-name"],
  "componentRules": [],
  "policyRules": [],
  "overwrite": false,
  "sourceRoot": "",
  "targetRoot": "",
  "pageHandling": "NONE"
}
```

### CSRF Handling

The extension injects the conversion fetch **into the active AEM tab** using `chrome.scripting.executeScript`. This ensures the request carries the correct `Referer` header that AEM's CsrfFilter requires. The CSRF token is fetched from `/libs/granite/csrf/token.json` before every POST.

For cloud environments, using a **Bearer token** bypasses CSRF entirely (token-based auth skips CsrfFilter by AEM design).

### Job History

Job history is read live from AEM's JCR paths:
- `/var/aem-modernize/job-data/component/YYYY/MM/DD/`
- `/var/aem-modernize/job-data/structure/YYYY/MM/DD/`
- `/var/aem-modernize/job-data/full/YYYY/MM/DD/`

Click any history entry to open the corresponding AEM job detail page at:
`/mnt/overlay/aem-modernize/content/component/job/view.html/<jobPath>`

---

## File Structure

```
aem-modernize-extension/
├── manifest.json          # Chrome extension manifest (MV3)
├── popup.html             # Extension popup UI
├── options.html           # Settings page
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   ├── background.js      # Service worker — SCAN_PAGE, SUBMIT_JOB, TEST_CONNECTION handlers
│   ├── content.js         # Floating agent panel — auto-scans AEM pages
│   ├── popup.js           # Popup UI logic — scan, conversion, history
│   └── options.js         # Settings save/load/test
└── styles/
    ├── popup.css           # Popup styles (light theme)
    └── options.css         # Options page styles (light theme)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Chrome Extension                                        │
│                                                          │
│  ┌──────────────┐    bgMsg()    ┌──────────────────────┐ │
│  │  popup.js    │ ────────────► │  background.js       │ │
│  │  (popup UI)  │              │  (service worker)     │ │
│  └──────────────┘              │                       │ │
│                                │  SCAN_PAGE            │ │
│  ┌──────────────┐    bgMsg()   │  → .component.rules   │ │
│  │  content.js  │ ────────────►│  → .template.rules    │ │
│  │  (page agent)│              │  → jcr:content.json   │ │
│  └──────────────┘              │                       │ │
│         │                      │  TEST_CONNECTION      │ │
│         │ executeScript        │  FETCH_RULES          │ │
│         ▼                      └──────────────────────┘ │
│  ┌─────────────────────────┐                            │
│  │  AEM Page Context       │   Conversion POSTs         │
│  │  (correct Referer)      │ ──────────────────────────►│
│  │  fetch() CSRF token     │   to AEM create.json       │
│  │  POST create.json       │                            │
│  └─────────────────────────┘                            │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
         AEM Author Instance
         /mnt/overlay/aem-modernize/...
         /var/aem-modernize/job-data/...
```

---

## Prerequisites

- Chrome browser (version 88+ for MV3 support)
- AEM Author instance with the **aem-modernize-tools** package installed
  - Verify: check `/system/console/bundles` for `aem-modernize-tools` bundle is **Active**
  - The job detail UI is accessible at `/mnt/overlay/aem-modernize/content/component/job/view.html`
- User account with:
  - Read access to content pages
  - Write access to `/var/aem-modernize/job-data/` (handled by service user `aem-modernize-convert-service` internally)

---

## Troubleshooting

### Scan shows 0 components
- Verify the aem-modernize-tools package is installed and active
- Check the endpoint manually: `GET <aem-url>/mnt/overlay/aem-modernize/content/component/job/create.component.rules.json?path=<your-page>&reprocess=false`
- Should return `{ "success": true, "rules": [...] }`

### HTTP 403 on conversion
- **Local**: Basic Auth with `admin/admin` should work — the servlet uses a service user internally
- **Cloud**: Add a Bearer token in Settings. Obtain from AEM Developer Console → Integrations

### HTTP 404 on conversion
- The aem-modernize-tools package is not installed
- Install via Package Manager: download from [Adobe GitHub Releases](https://github.com/adobe/aem-modernize-tools/releases)

### Floating panel not appearing
- The content script runs after a 2s delay — wait for page to fully load
- Check `chrome://extensions/?errors=<extension-id>` for JavaScript errors
- Ensure the extension has access to AEM pages (check host permissions in manifest)

### History tab empty
- Verify `/var/aem-modernize/job-data/` exists in CRXDE
- At least one conversion job must have been run through AEM Modernize Tools (via UI or this extension)

---

## Development

### Making changes

1. Edit files in the `aem-modernize-extension/` folder
2. Go to `chrome://extensions` → find the extension → click **↺ Reload**
3. No build step required — pure vanilla JS/CSS

### Key APIs used

| API | Purpose |
|---|---|
| `chrome.storage.local` | Persist server config, job history, last scan result |
| `chrome.scripting.executeScript` | Inject conversion fetch into AEM tab (for correct Referer) |
| `chrome.tabs.query` | Get active tab URL for content path extraction |
| `chrome.runtime.sendMessage` | Popup/content → background communication |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## Acknowledgements

Built on top of the [AEM Modernize Tools](https://opensource.adobe.com/aem-modernize-tools/) open-source project by Adobe.
