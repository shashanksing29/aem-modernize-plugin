# AEM Modernize Tools — Chrome Extension - V1.1

A Chrome extension that brings the power of [AEM Modernize Tools](https://opensource.adobe.com/aem-modernize-tools/) directly into your browser. Scan any AEM page for legacy components and static templates, then trigger component, page structure, or full conversion jobs without leaving the editor.

---

## What's New in V1.1

- **Zero configuration** — no server URL, username, or password needed. The extension auto-detects the AEM environment from the active tab URL and uses your existing browser session cookies
- **Removed Settings page** — no options page, no manual configuration at all
- **History sub-tabs** — filter job history by All / Component / Structure / Full, newest jobs shown first
- **Full Conversion mode** — trigger structure + component conversion in a single job
- **History injected into page context** — fetches job data using browser session, no auth headers needed

---

## Features

- **Zero configuration** — auto-detects AEM environment (Cloud SDK, AEMaaCS, AEM 6.5) from tab URL and uses existing browser session
- **Auto-scan AEM pages** — detects legacy components and static templates using native AEM Modernize Tools endpoints
- **Floating agent panel** — appears automatically on every AEM editor page showing SERVER, PAGE, component counts, rule counts, and conversion status
- **Popup scan** — manually scan the current page and see results in the extension popup
- **Three conversion modes** — Component Conversion, Page Structure, and Full Conversion (structure + components in one job)
- **Job history** — view past conversion jobs fetched live from `/var/aem-modernize/job-data/`, filtered by type, newest first, click any row to open job details
- **Light theme UI** — clean, professional design consistent across popup and floating agent panel
- **Works with AEM Cloud SDK, AEMaaCS, and AEM 6.5** — no Bearer token needed, browser session handles auth

---

## Screenshots

**Popup — Scan Results**

![Popup scan results showing Components to Convert, Matching Rules, Template status and conversion buttons](https://github.com/user-attachments/assets/782d139c-3453-40ca-980e-99a0a86af4ef)

**Floating Agent Panel**

![Floating agent panel showing SERVER, PAGE context, component counts and Convert buttons](https://github.com/user-attachments/assets/cadefec9-3c0b-4109-94fe-ffb531fa7a7f)

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

**None required.** Just install the extension, open any AEM editor page, and click **Scan Page**.

The extension automatically:
- Detects the AEM server from the active tab URL (`localhost:4502`, `author-p12345-e67890.adobeaemcloud.com`, etc.)
- Uses your existing browser session cookies for all requests — no login needed in the extension

---

## How It Works

### Auto-Detection

The extension detects the AEM environment from the active tab URL:

| URL Pattern | Environment |
|---|---|
| `author-p<id>-e<id>.adobeaemcloud.com` | AEM as a Cloud Service |
| `localhost:4502` | AEM Cloud SDK (local) |
| Any page with `/editor.html/content/` | AEM 6.5 on-prem or other |

All requests use `credentials: 'include'` and `chrome.scripting.executeScript` to run in the page context — the browser automatically sends the AEM session cookies, no manual auth configuration needed.

### Detection — Zero Configuration

The extension uses **AEM Modernize Tools native endpoints** — the same endpoints the AEM Modernize Tools UI uses internally:

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

> All payloads confirmed from AEM Modernize Tools UI network traces.

### CSRF Handling

AEM's `CsrfFilter` requires a valid CSRF token **and** a `Referer` header matching the AEM origin. Chrome extension service workers have no `Referer`, so the extension uses `chrome.scripting.executeScript` to inject all fetches **into the active AEM tab**. This ensures:

1. The fetch carries the correct `Referer` header automatically (set by the browser)
2. Session cookies are sent automatically — no manual auth needed
3. The CSRF token is fetched from `/libs/granite/csrf/token.json` in the same page context
4. Felix dispatcher accepts the request and routes it to `ScheduleConversionJobServlet`
5. The servlet uses service user `aem-modernize-convert-service` for all JCR writes — no special ACLs needed on `/var/aem-modernize/`

### Job History

History is fetched live from AEM's JCR — injected into the page context for correct session auth:

```
/var/aem-modernize/job-data/component/YYYY/MM/DD/<jobName>
/var/aem-modernize/job-data/structure/YYYY/MM/DD/<jobName>
/var/aem-modernize/job-data/full/YYYY/MM/DD/<jobName>
```

- Sorted **newest first** by job path (YYYY/MM/DD guarantees chronological order)
- Filtered by **All / Component / Structure / Full** sub-tabs
- Click any row to open the AEM job detail page

---

## File Structure

```
aem-modernize-extension/
├── manifest.json       # Chrome MV3 manifest
├── popup.html          # Extension popup UI
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── scripts/
│   ├── background.js   # Service worker — SCAN_PAGE, TEST_CONNECTION, env detection
│   ├── content.js      # Floating agent panel — auto-scans AEM editor pages
│   └── popup.js        # Popup UI — scan, conversion actions, history tab
└── styles/
    └── popup.css       # Popup + floating panel styles (light theme)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome Extension                                           │
│                                                             │
│  ┌──────────────┐   bgMsg(SCAN_PAGE) ┌──────────────────┐   │
│  │  popup.js    │ ──────────────────►│  background.js   │   │
│  │  (popup UI)  │                    │  (service worker)│   │
│  └──────────────┘                    │                  │   │
│                                      │  GET (with       │   │
│  ┌──────────────┐   bgMsg(SCAN_PAGE) │  session cookies)│   │
│  │  content.js  │ ──────────────────►│  .component.rules│   │
│  │  (page panel)│                    │  .template.rules │   │
│  └──────────────┘                    └──────────────────┘   │
│         │                                                   │
│         │ chrome.scripting.executeScript()                  │
│         ▼                                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  AEM Editor Tab (page context — same origin as AEM)  │   │
│  │                                                      │   │
│  │  Conversion:  GET csrf/token → POST create.json      │   │
│  │  History:     GET /var/aem-modernize/.5.json         │   │
│  │                                                      │   │
│  │  Browser sends session cookies automatically         │   │
│  │  Browser sets Referer header automatically           │   │
│  └──────────────────────────────────────────────────────┘   │
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
- **Be logged into AEM** in the same Chrome browser — the extension uses your existing session
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

Verify the aem-modernize-tools bundle is **Active** at `/system/console/bundles`. Also confirm you are logged into AEM in the same Chrome browser session.

### HTTP 404 on conversion

The package is not installed. Download from [GitHub Releases](https://github.com/adobe/aem-modernize-tools/releases) and install via CRX Package Manager.

### Floating panel not appearing

- Panel appears after a 2s delay — wait for the page to fully load
- Check for errors: `chrome://extensions/?errors=<extension-id>`
- Ensure the extension has permissions for the AEM domain

### History tab empty

- At least one job must exist under `/var/aem-modernize/job-data/` in CRXDE
- Run a conversion first (via this extension or the AEM Modernize Tools UI)
- Click **↺ Refresh** to force a fresh fetch

---

## Development

No build step required. Edit files and reload:

1. Edit any file in `aem-modernize-extension/`
2. Go to `chrome://extensions` → click **↺** on the extension
3. Changes take effect immediately

### Key Chrome APIs

| API | Used for |
|---|---|
| `chrome.scripting.executeScript` | Inject all AEM fetches into tab context (session cookies + Referer) |
| `chrome.tabs.query` | Get active tab URL for environment auto-detection |
| `chrome.storage.local` | Persist last scan result across popup open/close |
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

---

## Claude AI Skill — Writing Transformation Rules

This repository includes a Claude skill for **authoring AEM Modernize Tools transformation rules**. The skill teaches Claude the complete rule authoring format so you can describe a component migration in plain English and get back production-ready JCR node rules or OSGi configs.

### Skill location

```
skills/aem-modernize-rules.md
```

### What the skill covers

| Topic | Details |
|---|---|
| **Component rewrite rules** | Full JCR node structure in XML and JSON, all pattern matching options, all replacement features |
| **Page structure rules** | OSGi factory config format, every property explained, multi-tenant patterns |
| **Policy import rules** | Same structure as component rules, different OSGi PID |
| **Property expressions** | `${ }` copy syntax, default values, if/else fallback, boolean negation |
| **Property transforms** | `cq:rewriteProperties` (regex), `cq:rewriteMapProperties` (value mapping), `cq:rewriteConsolidateProperties` (merge) |
| **Child node handling** | `cq:copyChildren`, `cq:rewriteMapChildren`, `cq:orderBefore` |
| **Aggregation rules** | Merge multiple sibling components into one (e.g. image+title+text → Teaser) |
| **Decision guide** | Flowchart for choosing the right feature per scenario |
| **Common mistakes** | Table of pitfalls and correct approaches |

### Example prompts

Once the skill is loaded, you can ask Claude things like:

```
Write a component rewrite rule that converts myapp/components/title
to core/wcm/components/title/v3/title, copying jcr:title and
mapping the "type" property values: "heading1"→"h1", "heading2"→"h2"
```

```
Generate an OSGi page structure rule config for converting the
/apps/myapp/templates/homepage static template to the editable
template at /conf/myapp/settings/wcm/templates/homepage.
The old parsys "par" should be renamed to "root/container".
```

```
Write an aggregation rule that converts three sibling foundation
components (image, title, text) into a single Core Component teaser,
mapping fileReference from image, jcr:title from title, and
text from the text component.
```

### How to use the skill with Claude

If you are using [Claude.ai](https://claude.ai):

1. Open a new conversation
2. Upload `skills/aem-modernize-rules.md` as a file attachment
3. Say: *"Use this skill to write a rule that converts..."*

If you are using the Anthropic API, include the skill content in your system prompt or as a document in the messages array.
