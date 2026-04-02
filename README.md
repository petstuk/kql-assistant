<div align="center">
  <img src="icon.png" alt="KQL Assistant Logo" width="128"/>

  **KQL Assistant**

  Editing support for **Kusto Query Language (KQL)** on **Azure Monitor**, **Log Analytics**, **Microsoft Sentinel**, and related platforms.

  *Syntax validation · Schema-aware IntelliSense · Formatting · Quick fixes · Multi-query organization*
</div>

---

## At a glance

KQL Assistant is a **language support** extension: highlighting, diagnostics, completions, hover text, formatting, and lightweight project organization for `.kql` / `.kusto` files. It ships a large **offline** table/column catalog (700+ tables) so you get validation and suggestions without signing in to Azure.

**Out of scope:** this extension **does not execute queries**. It does not connect to an Azure Data Explorer cluster or a Log Analytics workspace. Run queries in the Azure portal, Microsoft Sentinel, Fabric, or another tool that supports execution against your data plane.

## Features

**Editing and syntax**

- Syntax highlighting, bracket/quote behavior, comments, folding
- Real-time diagnostics: brackets and strings, pipes, SQL-style patterns (`select` / `from`), structure

**IntelliSense and schemas**

- Completions for 719+ bundled tables, operators, chart types, and 100+ functions
- Column suggestions (with type and description) when table context is inferred
- Hover documentation for operators and functions; hover on **table names** and **column names** when the schema and context apply
- Signature help while typing function arguments

**Productivity**

- Format Document and Format Selection
- Code actions (lightbulb): typos, SQL-style fixes, brackets, missing `|`
- Optional markdown headers (`# Category #`, `## Rule ##`) with folding, outline navigation, and **KQL: Select Current Query** / **KQL: Copy Current Query**
- Inline CodeLens on headers (copy/select, line counts) where supported

## Installation

### VS Code Marketplace (recommended)

1. Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search for **KQL Assistant**
3. Install

Or open the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=petstuk.kql-assistant).

### From source or VSIX

```bash
git clone https://github.com/petstuk/kql-assistant.git
cd kql-assistant
npm install
npm run compile
```

- **Development:** press `F5` in VS Code (Extension Development Host)
- **VSIX:** `npm run package` then  
  `code --install-extension kql-assistant-0.8.1.vsix`

## Quick start

1. Open or create a file with extension `.kql` or `.kusto`
2. Start from a table name, then chain operators with `|`
3. Use **Format Document** (`Shift+Alt+F`) and the command **KQL: Check Syntax** when you want a full pass

## Organizing multiple queries

Use markdown-style headers so folds, outline, and CodeLens stay aligned:

- `# Category Name #` — group
- `## Rule or query name ##` — one query block

Example:

```kql
# Identity #

## Suspicious sign-ins ##

SigninLogs
| where ResultType != 0
| project TimeGenerated, UserPrincipalName, IPAddress

## Another rule ##

SigninLogs
| summarize c = count() by bin(TimeGenerated, 1h)
```

Fold arrows in the gutter collapse sections; use the **Outline** view to jump between blocks.

## Commands

| Command | Action |
|--------|--------|
| **KQL: Check Syntax** | Re-run diagnostics on the active file |
| **KQL: Select Current Query** | Select the query section around the cursor (respects header boundaries) |
| **KQL: Copy Current Query** | Copy query body to the clipboard (without the header line) |

Open via **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`).

## Configuration

| Setting | Default | Description |
|--------|---------|-------------|
| `kqlAssistant.enableDiagnostics` | `true` | Turn syntax/schema diagnostics on or off |
| `kqlAssistant.diagnosticLevel` | `error` | `error`, `warning`, or `information` |

In Settings, search for **KQL Assistant**.

## Snippets

There are **30+** snippets: type a prefix (e.g. `timerange`, `join`, `failedlogins`, `agg`) and press **Tab**. The full set is defined in [`snippets/kql.json`](snippets/kql.json) in this repository.

## Editor tips

- **Hover** operators, functions, tables, and columns (when context is known) for documentation
- **Lightbulb** fixes appear on diagnostics from KQL Assistant
- **Format Document** normalizes pipes, spacing, and commas (see also Format Selection for a range)

## Example queries

```kql
StormEvents
| where State == "TEXAS"
| project StartTime, EventType, DamageProperty
| take 10

StormEvents
| summarize EventCount = count(), TotalDamage = sum(DamageProperty) by State
| order by TotalDamage desc

StormEvents
| where StartTime >= ago(30d)
| extend Month = startofmonth(StartTime)
| summarize count() by Month, EventType
| render timechart
```

## Supported language surface (summary)

KQL is large; the extension focuses on common **keywords**, **tabular operators**, **aggregation** helpers (`count`, `sum`, `dcount`, `make_list`, …), and **scalar** functions (`ago`, `bin`, `parse_json`, `tostring`, …). Completions and hovers cover a substantial subset; see [KQL reference](https://learn.microsoft.com/en-us/kusto/query/) for the full language.

## Known limitations

- Join column validation across tables is incomplete
- Heavy use of subqueries or dynamic SQL may produce imperfect diagnostics
- Function parameter **types** are not deeply validated
- Workspace-specific or custom table schemas are not loaded from your tenant (bundled schemas only)

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for bug reports, feature ideas, and development setup.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Built using Microsoft’s [KQL documentation](https://learn.microsoft.com/en-us/kusto/query/) and community practice for Log Analytics and Sentinel queries.

## Release notes (recent)

### 0.8.1

- Documentation: clearer Marketplace README; full history in [CHANGELOG.md](CHANGELOG.md).

### 0.8.0

- Full-schema **table** completions; **schema-backed hover** for tables and columns; single shared schema load; **quick fix** alignment for SQL-style messages and bracket/`from` fixes.

### 0.7.3

- CodeLens line/rule counts on headers; redundant header hover removed.

Earlier versions: [CHANGELOG.md](CHANGELOG.md).
