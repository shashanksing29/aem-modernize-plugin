# SKILL: AEM Modernize Tools — Transformation Rule Authoring

## When to use this skill

Use this skill whenever the user asks you to:
- Write, generate, or review **component rewrite rules** for AEM Modernize Tools
- Write **page structure rewrite rules** (OSGi config) for template conversion
- Write **policy import rules**
- Convert a legacy AEM component definition to a modern Core Component rule
- Explain how AEM Modernize Tools rules work
- Debug a rule that isn't matching or transforming correctly

---

## Overview of Rule Types

AEM Modernize Tools has three rule types, each with a different format:

| Type | Format | Location |
|---|---|---|
| **Component Rewrite Rules** | JCR node tree (XML / JSON) | `/var/componentconversion/set/<ruleName>` |
| **Page Structure Rules** | OSGi service factory config | `/apps/<project>/config/com.adobe.aem.modernize.structure.impl.rule.PageStructureRewriteRuleImpl-<name>.cfg.json` |
| **Policy Import Rules** | JCR node tree (XML / JSON) | Same structure as component rules |

---

## PART 1: Component Rewrite Rules

### Rule Structure

Every component rewrite rule is a JCR node with two required children: `patterns` and `replacement`.

```xml
<myRule jcr:primaryType="nt:unstructured"
        jcr:title="Human-readable rule name"
        cq:rewriteRanking="{Long}1">

  <patterns jcr:primaryType="nt:unstructured">
    <pattern jcr:primaryType="nt:unstructured"
             sling:resourceType="old/component/path"/>
  </patterns>

  <replacement jcr:primaryType="nt:unstructured">
    <newNode jcr:primaryType="nt:unstructured"
             sling:resourceType="new/component/path"
             someStaticProp="staticValue"
             copiedProp="${'./originalPropName'}"/>
  </replacement>

</myRule>
```

In JSON (FileVault / content package format):
```json
{
  "myRule": {
    "jcr:primaryType": "nt:unstructured",
    "jcr:title": "Human-readable rule name",
    "cq:rewriteRanking": 1,
    "patterns": {
      "jcr:primaryType": "nt:unstructured",
      "pattern": {
        "jcr:primaryType": "nt:unstructured",
        "sling:resourceType": "old/component/path"
      }
    },
    "replacement": {
      "jcr:primaryType": "nt:unstructured",
      "newNode": {
        "jcr:primaryType": "nt:unstructured",
        "sling:resourceType": "new/component/path",
        "copiedProp": "${'./originalPropName'}"
      }
    }
  }
}
```

---

### Patterns — Matching Rules

**The `patterns` node must be named exactly `patterns`.** Each child of `patterns` is a separate pattern. The rule applies if ANY one pattern matches.

#### Basic pattern (minimum required)
```xml
<patterns jcr:primaryType="nt:unstructured">
  <myPattern jcr:primaryType="nt:unstructured"
             sling:resourceType="myapp/components/text"/>
</patterns>
```

#### Pattern with additional required properties
```xml
<patterns jcr:primaryType="nt:unstructured">
  <myPattern jcr:primaryType="nt:unstructured"
             sling:resourceType="myapp/components/text"
             textIsRich="{Boolean}true"/>
</patterns>
```
All properties listed must match exactly. Missing properties = no match.

#### Multiple patterns (OR logic — any match applies the rule)
```xml
<patterns jcr:primaryType="nt:unstructured">
  <patternV1 jcr:primaryType="nt:unstructured"
             sling:resourceType="myapp/components/text"/>
  <patternV2 jcr:primaryType="nt:unstructured"
             sling:resourceType="myapp/components/text-v2"/>
</patterns>
```

#### Optional child node in pattern
```xml
<patterns jcr:primaryType="nt:unstructured">
  <myPattern jcr:primaryType="nt:unstructured"
             sling:resourceType="myapp/components/image">
    <items jcr:primaryType="nt:unstructured"
           cq:rewriteOptional="{Boolean}true"/>
  </myPattern>
</patterns>
```
`cq:rewriteOptional="true"` — if this child doesn't exist, the pattern still matches. If it does exist, it must also match.

#### Relative sling:resourceType matching (v2.1+)
```xml
<!-- All three match "apps/myapp/components/text" -->
<patterns jcr:primaryType="nt:unstructured">
  <p1 jcr:primaryType="nt:unstructured" sling:resourceType="apps/myapp/components/text"/>
  <p2 jcr:primaryType="nt:unstructured" sling:resourceType="myapp/components/text"/>
  <p3 jcr:primaryType="nt:unstructured" sling:resourceType="components/text"/>
  <!-- WARNING: "text" alone would match ANY RT ending in "text" - be specific! -->
</patterns>
```

---

### Replacement — Transformation Rules

**Only one replacement child node is processed** (additional children are ignored).

#### Static values only (simplest case)
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/text/v2/text"
           textIsRich="{Boolean}true"/>
</replacement>
```
No original content is preserved. The old node is replaced with exactly this structure.

#### Copy properties with `${ }` expression syntax
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/text/v2/text"
           text="${'./text'}"
           textIsRich="${'./textIsRich'}"/>
</replacement>
```

**Expression rules:**
- `${'./propName'}` — copy property from original node. Use single quotes, especially for names with `:`.
- `${'./jcr:title'}` — copy `jcr:title` (colon requires quotes)
- If property is not found on original: that property is silently omitted from the replacement.

#### Default value when property missing
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/text/v2/text"
           type="${'./headingLevel':h2}"/>
           <!-- if headingLevel missing → sets type="h2" -->
</replacement>
```

#### If/else fallback between two properties
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/image/v3/image"
           alt="[${'./altText'}, ${'./jcr:title'}]"/>
           <!-- use altText if present, fall back to jcr:title -->
</replacement>
```

#### Boolean negation
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/text/v2/text"
           hideLabel="!${'./showLabel'}"/>
</replacement>
```

#### Copy children (preserve child node tree)
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/list/v3/list"
           cq:copyChildren="{Boolean}true"/>
</replacement>
```
All child nodes of the matched source are copied to the replacement, names and order preserved.

#### Rename/reorder children
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/container/v1/container"
           cq:copyChildren="{Boolean}true">
    <items jcr:primaryType="nt:unstructured"
           cq:rewriteMapChildren="./oldItems"
           cq:orderBefore="nextSibling"/>
    <!-- Renames "oldItems" child to "items" and places it before "nextSibling" -->
  </newNode>
</replacement>
```

#### Regex property rewriting with `cq:rewriteProperties`
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/title/v3/title"
           type="${'./type'}">
    <cq:rewriteProperties jcr:primaryType="nt:unstructured"
        type="[(?:heading)([1-6]), h$1]"/>
        <!-- transforms "heading1" → "h1", "heading2" → "h2", etc. -->
  </newNode>
</replacement>
```
Format: `propertyName="[regexPattern, replacement]"` — Java regex, supports capture groups `$1`, `$2`.

#### Value mapping with `cq:rewriteMapProperties`
```xml
<replacement jcr:primaryType="nt:unstructured">
  <newNode jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/button/v1/button"
           variant="${'./style'}">
    <cq:rewriteMapProperties jcr:primaryType="nt:unstructured">
      <variant jcr:primaryType="nt:unstructured"
               primary="cta"
               secondary="ghost"
               tertiary="quiet"/>
      <!-- "primary" → "cta", "secondary" → "ghost", "tertiary" → "quiet" -->
    </cq:rewriteMapProperties>
  </newNode>
</replacement>
```

#### Consolidate multiple properties into one multi-value property
```json
{
  "replacement": {
    "jcr:primaryType": "nt:unstructured",
    "newNode": {
      "jcr:primaryType": "nt:unstructured",
      "sling:resourceType": "core/wcm/components/text/v2/text",
      "title": "${'./jcr:title'}",
      "description": "${'./jcr:description'}",
      "cq:rewriteConsolidateProperties": {
        "jcr:primaryType": "nt:unstructured",
        "combined": ["title", "description"]
      }
    }
  }
}
```
Merges `title` and `description` into a multi-value property `combined`, then removes the originals.

#### Mark node as final (skip re-processing)
```xml
<replacement jcr:primaryType="nt:unstructured"
             cq:rewriteFinal="{Boolean}true">
  <newNode .../>
</replacement>
```

---

### Aggregation Rules (Component Consolidation)

Aggregation rules match a **sequence of sibling components** and replace them with a single component. Used to consolidate old foundation components (image + title + text) into a single Core Component (Teaser).

```xml
<teaserRule jcr:primaryType="nt:unstructured"
            jcr:title="Image+Title+Text → Teaser"
            cq:rewriteRanking="{Long}1">

  <aggregate jcr:primaryType="nt:unstructured">
    <patterns jcr:primaryType="nt:unstructured">
      <imagePattern jcr:primaryType="nt:unstructured"
                    sling:resourceType="foundation/components/image"/>
      <titlePattern jcr:primaryType="nt:unstructured"
                    sling:resourceType="foundation/components/title"/>
      <textPattern  jcr:primaryType="nt:unstructured"
                    sling:resourceType="foundation/components/text"/>
    </patterns>
  </aggregate>

  <replacement jcr:primaryType="nt:unstructured">
    <teaser jcr:primaryType="nt:unstructured"
            sling:resourceType="core/wcm/components/teaser/v2/teaser"
            jcr:title="${'./[pattern:titlePattern]/jcr:title'}"
            jcr:description="${'./[pattern:textPattern]/text'}"
            fileReference="${'./[pattern:imagePattern]/fileReference'}"
            imageAlt="${'./[pattern:imagePattern]/alt'}"/>
  </replacement>

</teaserRule>
```

**Key rule for aggregation:** Use `[pattern:patternNodeName]` in expressions to reference properties from a specific pattern match:
- `${'./[pattern:imagePattern]/fileReference'}` — get `fileReference` from whichever node matched `imagePattern`

---

### Complete Real-World Example: Foundation Title → Core Title

```xml
<coreTitle jcr:primaryType="nt:unstructured"
           jcr:title="Foundation Title → Core Title v3"
           cq:rewriteRanking="{Long}10">

  <patterns jcr:primaryType="nt:unstructured">
    <foundationTitle jcr:primaryType="nt:unstructured"
                     sling:resourceType="foundation/components/title"/>
    <geometrixxTitle jcr:primaryType="nt:unstructured"
                     sling:resourceType="geometrixx/components/title"/>
  </patterns>

  <replacement jcr:primaryType="nt:unstructured">
    <title jcr:primaryType="nt:unstructured"
           sling:resourceType="core/wcm/components/title/v3/title"
           jcr:title="${'./jcr:title'}"
           type="${'./type':h2}"
           linkURL="${'./linkURL'}">
      <cq:rewriteProperties jcr:primaryType="nt:unstructured"
          type="[h([1-6]), h$1]"/>
    </title>
  </replacement>

</coreTitle>
```

---

## PART 2: Page Structure Rewrite Rules (OSGi Config)

Page structure rules are **not** JCR node-based — they are OSGi factory configurations, one per static template to convert.

### File format (AEM 6.5 / Cloud SDK)

Path: `/apps/<project>/config/com.adobe.aem.modernize.structure.impl.rule.PageStructureRewriteRuleImpl-<templateName>.cfg.json`

```json
{
  "static.template": "/apps/myapp/templates/homepage",
  "sling.resourceType": "myapp/components/structure/page",
  "editable.template": "/conf/myapp/settings/wcm/templates/homepage",
  "container.resourceType": "myapp/components/container",
  "allowed.paths": [
    "/content/myapp(/.*)?",
    "/content/other-tenant(/.*)?",
  ],
  "node.ordering": [
    "header",
    "hero",
    "content:main",
    "footer"
  ],
  "node.renaming": [
    "par:root/container",
    "rightpar:root/right",
    "header:header"
  ],
  "node.ignoring": [
    "cq:LiveSyncConfig",
    "cq:BlueprintSyncConfig",
    "myStaticNode"
  ],
  "node.removal": [
    "leftNavigation",
    "breadcrumb"
  ]
}
```

### OSGi config properties explained

| Property | Type | Description |
|---|---|---|
| `static.template` | String | `cq:template` value on pages to convert. Must match exactly. |
| `sling.resourceType` | String | `sling:resourceType` of page component to convert. Both this AND `static.template` must match. |
| `editable.template` | String | New `cq:template` value after conversion. Must exist in `/conf`. |
| `container.resourceType` | String | Resource type of the Core Component container proxy to use as the root container. |
| `allowed.paths` | String[] | Regex patterns. Only pages under these paths are eligible. Default: all paths. |
| `node.ordering` | String[] | Order of nodes in the new root container. Use `:` for parent/child. Unlisted nodes appended at end. |
| `node.renaming` | String[] | `oldName:newName` pairs. Moves/renames nodes. Supports relative paths for relocation. |
| `node.ignoring` | String[] | Node names to leave in place (not moved to container). Always includes `cq:LiveSyncConfig`. |
| `node.removal` | String[] | Node names to remove entirely during conversion. |

### Multiple tenants / templates

Create one `.cfg.json` file per template. The `-<name>` suffix in the filename is the OSGi factory instance name — make it descriptive:

```
com.adobe.aem.modernize.structure.impl.rule.PageStructureRewriteRuleImpl-homepage.cfg.json
com.adobe.aem.modernize.structure.impl.rule.PageStructureRewriteRuleImpl-landingpage.cfg.json
com.adobe.aem.modernize.structure.impl.rule.PageStructureRewriteRuleImpl-articlepage.cfg.json
```

Use `allowed.paths` to restrict the same static template configuration to different tenants:

```json
// File: ...PageStructureRewriteRuleImpl-homepage-tenantA.cfg.json
{
  "static.template": "/apps/myapp/templates/homepage",
  "sling.resourceType": "myapp/components/structure/page",
  "editable.template": "/conf/tenantA/settings/wcm/templates/homepage",
  "container.resourceType": "tenantA/components/container",
  "allowed.paths": ["/content/tenantA(/.*)?"]
}

// File: ...PageStructureRewriteRuleImpl-homepage-tenantB.cfg.json
{
  "static.template": "/apps/myapp/templates/homepage",
  "sling.resourceType": "myapp/components/structure/page",
  "editable.template": "/conf/tenantB/settings/wcm/templates/homepage",
  "container.resourceType": "tenantB/components/container",
  "allowed.paths": ["/content/tenantB(/.*)?"]
}
```

---

## PART 3: Policy Import Rules

Policy import rules share the exact same node structure as component rewrite rules. The only difference is the OSGi config PID for `search.paths`:

- Component rules: `com.adobe.aem.modernize.component.impl.ComponentRewriteRuleServiceImpl`
- Policy rules: `com.adobe.aem.modernize.policy.impl.PolicyImportRuleServiceImpl`

Policy rules transform design dialog properties into editable template policy structures.

```xml
<textPolicy jcr:primaryType="nt:unstructured"
            jcr:title="Text Component Policy">

  <patterns jcr:primaryType="nt:unstructured">
    <pattern jcr:primaryType="nt:unstructured"
             sling:resourceType="myapp/components/text"/>
  </patterns>

  <replacement jcr:primaryType="nt:unstructured">
    <policy jcr:primaryType="nt:unstructured"
            sling:resourceType="core/wcm/components/text/v2/text"
            features="${'./features'}"
            pluginConfig="${'./pluginConfig'}"/>
  </replacement>

</textPolicy>
```

---

## OSGi Configuration for Rule Discovery

### Component rules search path
```json
// /apps/<project>/config/com.adobe.aem.modernize.component.impl.ComponentRewriteRuleServiceImpl.cfg.json
{
  "search.paths": [
    "/var/componentconversion/set",
    "/var/componentconversion/other-set"
  ]
}
```

### Policy rules search path
```json
// /apps/<project>/config/com.adobe.aem.modernize.policy.impl.PolicyImportRuleServiceImpl.cfg.json
{
  "search.paths": [
    "/var/policyimport/set"
  ]
}
```

---

## Output Formats

When writing rules, output in whichever format the user requests. Default to XML (most common in content packages). If unsure, ask.

### XML (FileVault .content.xml)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<jcr:root xmlns:jcr="http://www.jcp.org/jcr/1.0"
          xmlns:nt="http://www.jcp.org/jcr/nt/1.0"
          xmlns:sling="http://sling.apache.org/jcr/sling/1.0"
          xmlns:cq="http://www.day.com/jcr/cq/1.0"
          jcr:primaryType="nt:unstructured">

  <myRule jcr:primaryType="nt:unstructured"
          jcr:title="My Rule">
    <patterns jcr:primaryType="nt:unstructured">
      <pattern jcr:primaryType="nt:unstructured"
               sling:resourceType="old/resource/type"/>
    </patterns>
    <replacement jcr:primaryType="nt:unstructured">
      <node jcr:primaryType="nt:unstructured"
            sling:resourceType="new/resource/type"/>
    </replacement>
  </myRule>

</jcr:root>
```

### JSON (Sling content loader / API)
```json
{
  "jcr:primaryType": "nt:unstructured",
  "myRule": {
    "jcr:primaryType": "nt:unstructured",
    "jcr:title": "My Rule",
    "patterns": {
      "jcr:primaryType": "nt:unstructured",
      "pattern": {
        "jcr:primaryType": "nt:unstructured",
        "sling:resourceType": "old/resource/type"
      }
    },
    "replacement": {
      "jcr:primaryType": "nt:unstructured",
      "node": {
        "jcr:primaryType": "nt:unstructured",
        "sling:resourceType": "new/resource/type"
      }
    }
  }
}
```

---

## Common Mistakes to Avoid

| Mistake | Correct Approach |
|---|---|
| Naming patterns node anything other than `patterns` | Always name it exactly `patterns` |
| Not quoting property names containing `:` in expressions | Use `${'./jcr:title'}` not `${'./jcr:title'}` |
| Using a relative RT like `text` in patterns | Be specific — `myapp/components/text` — short RTs match too broadly |
| Multiple children in `replacement` expecting all to be processed | Only the first child of `replacement` is processed |
| Using `cq:rewriteProperties` for a property not listed in the replacement | Must be in the replacement definition first |
| Page structure rule: `editable.template` path doesn't exist in `/conf` | Verify template exists before running conversion |
| Omitting `jcr:primaryType="nt:unstructured"` from any node | Every node needs this |
| Aggregation: referencing pattern by index instead of name | Use `[pattern:patternNodeName]` not positional references |

---

## Decision Guide: Which Features to Use

```
Need to convert one component to another?
  → Simple replacement with property copies

Properties have different names in old vs new?
  → Use ${'./oldName'} mapped to newName in replacement

Property values need transforming (e.g. "heading1" → "h1")?
  → cq:rewriteProperties with regex

Property values need exact mapping ("primary" → "cta")?
  → cq:rewriteMapProperties

Old component has children to preserve?
  → cq:copyChildren="{Boolean}true"

Children need to be renamed?
  → cq:rewriteMapChildren + cq:orderBefore

Multiple old components merge into one?
  → Aggregation rule with [pattern:name] references

Converting multiple versions of the same component?
  → Multiple patterns in one rule (OR logic)

Converting static template to editable template?
  → OSGi PageStructureRewriteRuleImpl config (not JCR nodes)

Need same template to produce different output per tenant?
  → Multiple OSGi configs with different allowed.paths
```

---

## References

- Component Config: https://opensource.adobe.com/aem-modernize-tools/pages/component/config.html
- Structure Config: https://opensource.adobe.com/aem-modernize-tools/pages/structure/config.html
- Policy Config: https://opensource.adobe.com/aem-modernize-tools/pages/policy/config.html
- API Docs: https://opensource.adobe.com/aem-modernize-tools/apidocs/index.html
