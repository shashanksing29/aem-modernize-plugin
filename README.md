# AEM Modernize Tools — Chrome Extension

A Chrome extension that brings the power of [AEM Modernize Tools](https://opensource.adobe.com/aem-modernize-tools/) directly into your browser. Scan any AEM page for legacy components and static templates, then trigger component, page structure, or full conversion jobs without leaving the editor.

---

## Features

- **Auto-scan AEM pages** — detects legacy components and static templates using native AEM Modernize Tools endpoints, zero configuration required
- **Floating agent panel** — appears automatically on every AEM editor page showing SERVER, PAGE, component counts, rule counts, and conversion status
- **Popup scan** — manually scan the current page and see results in the extension popup
- **Three conversion modes** — trigger Component Conversion, Page Structure conversion, or Full Conversion (structure + components in one job) directly from the browser
- **Job history** — view past conversion jobs fetched live from `/var/aem-modernize/job-data/` with click-to-open job details
- **Light theme UI** — clean, professional design consistent across popup and floating agent panel
- **Works with AEM Cloud SDK, AEMaaCS, and AEM 6.5** — Bearer token support for cloud environments

---

## Installation

### From source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `aem-modernize-extension` folder
6. The extension icon appears in your Chrome toolbar

> **No build step required** — pure vanilla JS/CSS, no bundler or npm needed.

---

## Configuration

Click the **⚙ gear icon** in the popup (or right-click the extension → Options) to open Settings.

### Server Connection

| Field | Description |
|---|---|
| **AEM Author URL** | Your AEM Author instance, e.g. `http://localhost:4502` — no trailing slash |
| **Username** | AEM username — default `admin` for local |
| **Password** | AEM password — default `admin` for local |
| **Developer / Bearer Token** | IMS Bearer token for AEMaaCS cloud environments — bypasses CSRF entirely (recommended for cloud) |

### Auth Modes

| Environment | Recommended Auth | Notes |
|---|---|---|
| Local AEM Cloud SDK (`localhost`) | Basic Auth — `admin / admin` | CSRF bypassed automatically |
| AEM as a Cloud Service | Bearer / Dev Token | Obtain from AEM Developer Console |
| AEM 6.5 on-prem | Basic Auth with your credentials | CSRF handled via token in request body |

**To get a Bearer token on AEMaaCS:**
1. Go to your AEM environment → Developer Console
2. Navigate to the **Integrations** tab
3. Click **Get Local Development Token** and copy the access token
4. Paste it into the **Developer / Bearer Token** field in Settings

---

## How It Works

### Detection — Zero Configuration

The extension uses **AEM Modernize Tools native endpoints** — the same endpoints the AEM Modernize Tools UI uses internally. No manual path configuration required.

| Step | Endpoint | Returns |
|---|---|---|
| Component scan | `.component.rules.json?path=<page>&reprocess=false` | `{ success, paths: [compPaths], rules: [{id, title}] }` |
| Template status | `.template.rules.json?path=<page>&reprocess=false` | `{ success, paths, rules: [{id: "com.acme...Rule~name", title}] }` |

**Classification logic:**
- `rules.length > 0` → page has **legacy components / static template** needing conversion
- `rules.length === 0` → already using modern components / editable template

### Conversion Modes

| Mode | Endpoint | What it converts |
|---|---|---|
| **Component Conversion** | `.../component/job/create.json` | `sling:resourceType` values on legacy components |
| **Page Structure** | `.../structure/job/create.json` | Static `cq:template` → editable template |
| **Full Conversion** | `.../full/job/create.json` | Both structure + components in a single job |

#### Component Conversion Payload
```json
{
  "name": "ext-1234567890",
  "type": "COMPONENT",
  "paths": ["/content/site/page/jcr:content/root/container/responsivegrid"],
  "componentRules": ["/var/componentconversion/set/rule1"],
  "templateRules": [],
  "policyRules": [],
  "overwrite": false
}
```

#### Page Structure Payload
```json
{
  "name": "ext-1234567890",
  "type": "STRUCTURE",
  "paths": ["/content/site/page"],
  "templateRules": ["com.acme.foundation.impl.PageRewriteRule~page-name"],
  "componentRules": [],
  "policyRules": [],
  "overwrite": false,
  "sourceRoot": "",
  "targetRoot": "",
  "pageHandling": "NONE"
}
```

#### Full Conversion Payload
```json
{
  "name": "ext-1234567890",
  "type": "FULL",
  "paths": ["/content/site/page"],
  "templateRules": ["com.acme.foundation.impl.PageRewriteRule~page-name"],
  "componentRules": ["/var/componentconversion/set/rule1"],
  "policyRules": [],
  "overwrite": false,
  "sourceRoot": "",
  "targetRoot": "",
  "pageHandling": "NONE"
}
```

> All payloads are confirmed from AEM Modernize Tools UI network traces.

### CSRF Handling

AEM's `CsrfFilter` requires a valid CSRF token **and** a `Referer` header matching the AEM origin. Chrome extension service workers have no `Referer`, so the extension uses `chrome.scripting.executeScript` to inject the conversion fetch **into the active AEM tab**. This ensures:

1. The fetch carries the correct `Referer` header automatically (set by the browser)
2. The CSRF token is fetched from `/libs/granite/csrf/token.json` in the same page context
3. Felix dispatcher accepts the request and routes it to `ScheduleConversionJobServlet`
4. The servlet uses service user `aem-modernize-convert-service` for all JCR writes — no special ACLs needed on `/var/aem-modernize/`

For cloud environments, a **Bearer token** bypasses CSRF entirely — AEM treats token-based auth as API/service access and skips `CsrfFilter`.

### Job History

History is read live from AEM's JCR — no local storage involved:

```
/var/aem-modernize/job-data/component/YYYY/MM/DD/<jobName>
/var/aem-modernize/job-data/structure/YYYY/MM/DD/<jobName>
/var/aem-modernize/job-data/full/YYYY/MM/DD/<jobName>
```

Click any row in the History tab to open the AEM job detail page:
```
/mnt/overlay/aem-modernize/content/component/job/view.html/<jobDataPath>
```

---

## File Structure

```
aem-modernize-extension/
├── manifest.json           # Chrome MV3 manifest
├── popup.html              # Extension popup UI
├── options.html            # Settings page
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   ├── background.js       # Service worker — SCAN_PAGE, TEST_CONNECTION, FETCH_RULES, history
│   ├── content.js          # Floating agent panel — auto-scans AEM editor pages
│   ├── popup.js            # Popup UI — scan, conversion actions, history tab
│   └── options.js          # Settings — save/load/test server connection
└── styles/
    ├── popup.css           # Popup + floating panel styles (light theme)
    └── options.css         # Settings page styles (light theme)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome Extension                                            │
│                                                              │
│  ┌──────────────┐   bgMsg(SCAN_PAGE)  ┌──────────────────┐  │
│  │  popup.js    │ ──────────────────► │  background.js   │  │
│  │  (popup UI)  │                    │  (service worker) │  │
│  └──────────────┘                    │                   │  │
│                                      │  GET              │  │
│  ┌──────────────┐   bgMsg(SCAN_PAGE) │  .component.rules │  │
│  │  content.js  │ ──────────────────►│  .template.rules  │  │
│  │  (page panel)│                    │  jcr:content.json │  │
│  └──────────────┘                    └──────────────────┘  │
│         │                                                    │
│         │ chrome.scripting.executeScript()                   │
│         ▼                                                    │
│  ┌─────────────────────────────────┐                        │
│  │  AEM Editor Tab (page context)  │                        │
│  │                                 │  POST create.json      │
│  │  1. GET csrf/token.json         │ ─────────────────────► │
│  │  2. POST .../job/create.json    │  with Referer header   │
│  │  (browser sets Referer auto)    │                        │
│  └─────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
           AEM Author Instance
           ScheduleConversionJobServlet
           → service user: aem-modernize-convert-service
           → /var/aem-modernize/job-data/...
```

---

## Prerequisites

- **Chrome** 88+ (Manifest V3 support)
- **AEM Author** instance with `aem-modernize-tools` package installed and **Active**
  - Verify at: `<aem-url>/system/console/bundles` → search `aem-modernize`
  - Job UI accessible at: `/mnt/overlay/aem-modernize/content/component/job/view.html`
- **User permissions:**
  - `jcr:read` on content pages being converted
  - Permission to invoke the conversion servlets (admin has this by default)
  - The `aem-modernize-convert-service` service user handles all `/var/aem-modernize/` writes internally

---

## Troubleshooting

### Scan shows 0 components / rules

Verify the endpoint manually in your browser (while logged in to AEM):
```
GET <aem-url>/mnt/overlay/aem-modernize/content/component/job/create.component.rules.json
    ?path=/content/your/page&reprocess=false
```
Expected response: `{ "success": true, "rules": [...] }`

If empty, the `ComponentRewriteRuleServiceImpl` OSGi service may need `search.paths` configured at:
`System Console → OSGi → com.adobe.aem.modernize.component.impl.ComponentRewriteRuleServiceImpl`

### HTTP 403 on conversion

| Scenario | Fix |
|---|---|
| Local Cloud SDK / AEM 6.5 | Should work with Basic Auth — check AEM error logs for root cause |
| AEMaaCS cloud | Add a Bearer/Dev token in Settings |
| Any | Verify the aem-modernize-tools bundle is **Active** |

### HTTP 404 on conversion

The package is not installed. Download from [GitHub Releases](https://github.com/adobe/aem-modernize-tools/releases) and install via CRX Package Manager.

### Floating panel not appearing

- Panel appears after a 2s delay — wait for the page to fully load
- Check for errors: `chrome://extensions/?errors=<extension-id>`
- Ensure the extension has permissions for the AEM domain

### History tab empty

- At least one job must exist under `/var/aem-modernize/job-data/` in CRXDE
- Run a conversion first (via this extension or the AEM Modernize Tools UI)

---

## Development

No build step required. Edit files and reload:

1. Edit any file in `aem-modernize-extension/`
2. Go to `chrome://extensions` → click **↺** on the extension
3. Changes take effect immediately

### Key Chrome APIs

| API | Used for |
|---|---|
| `chrome.storage.local` | Server config, last scan result (persists across popup close) |
| `chrome.scripting.executeScript` | Inject conversion fetch into AEM tab (correct Referer) |
| `chrome.tabs.query` | Get active tab URL to extract content path |
| `chrome.runtime.sendMessage` | Popup / content script → background worker |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit: `git commit -m 'feat: describe your change'`
4. Push: `git push origin feature/your-feature`
5. Open a Pull Request

---

## Acknowledgements

Built on top of the [AEM Modernize Tools](https://opensource.adobe.com/aem-modernize-tools/) open-source project by Adobe.
