# Changelog

All notable changes to **KQL Assistant** are documented here. The [README](README.md) highlights the latest releases for the VS Code Marketplace.

## Unreleased

**Sprint 3 — SOC packaging:**

- **Analytics rule export**: `KQL: Export Analytics Rule YAML` (+ CodeLens) builds a Sentinel scheduled-rule stub from `## Rule ##` blocks.
- **Rule metadata**: Parse `// tactic:`, `// technique:`, `// severity:`, `// description:`, `// queryFrequency:` under headers; surface in CodeLens and Outline.
- **Lookup / IOC**: Join-shaped `lookup` column validation; `datatable(...)` IOC lists via `let` get column scope; removed legacy line-scanner dead code from `syntaxChecker`.

**Sprint 2 — engineer value:**

- **Lint pack**: New `kqlAssistant.lintMode` (`off` | `basic` | `strict`) with rules KQL101–KQL105 (early time filter, join `kind=`, prefer `has` over `contains`, bare `search`/`find`, strict project-after-join).
- **CLI**: `kql-assistant lint` / `npm run lint:kql` for detection-as-code CI (`--format text|sarif`, `--packs`, `--fail-on`).
- **Schema packs**: `kqlAssistant.schemaPacks` (`all`, `sentinel-core`, `mde`, `identity`, `asim`, `asim-parsers`) plus offline `_Im_*` ASIM parser stubs in `schemas/asim-parsers.json`.

**Sprint 1 — security credibility:**

- **Schema**: Added `SecurityAlert` and `Syslog` from Azure Monitor reference columns (catalog now 721 tables).
- **Snippets**: Fixed `securityalerts` to use `AlertSeverity` (not `Severity`); added MDE process/network, ASIM network, watchlist join, TI IP match, syslog auth, and `hasfilter` starters with early `TimeGenerated` filters.
- **Tests**: Snippet table existence + security-snippet offline validation coverage.
- **Packaging**: Moved `pdf-parse` to `devDependencies` (schema tooling only; not needed at extension runtime). `.gitignore` already excludes `*.vsix`.

## 0.9.1

**Logo and quick UX fixes:**

- **New extension icon**: geometric “K” mark for Marketplace and README.
- **Ignore unknown table**: lightbulb now persists the table name in `kqlAssistant.ignoredTables` (workspace) and suppresses matching diagnostics.
- **Missing pipe diagnostics**: lines that start with a tabular operator without `|` (e.g. `where …`) are flagged; the existing Add pipe quick fix applies.
- **Join completions**: after `| join`, offer join-kind / related keyword completions.
- **Lookup hover**: hover docs for `lookup` aligned with completions.
- **Activation**: activate on `onLanguage:kql` instead of every VS Code startup.
- **Packaging**: tighter `.vscodeignore` (exclude tests, CI, examples, stale `out/` artifacts).

## 0.9.0

**Parser-backed query understanding:**

- **Shared QueryModel**: Diagnostics, completions, and hovers now use a common model for query blocks, pipe steps, source tables, aliases, `let` table bindings, and current column scope.
- **Better joins**: Join key validation now handles common multiline `join (...) on ...` shapes, extending the 0.8.3 single-line support.
- **Scope isolation**: Multi-query files and markdown-header sections keep column scopes separate, reducing alias leakage and false confidence.
- **Deeper column checks**: `project-away` and simple `mv-expand` are validated instead of being treated as skipped validation paths. `lookup` still emits an information diagnostic where column validation is limited.
- **Editor consistency**: Column completions and schema-backed hover use the same query scope as diagnostics instead of separate backward scans.
- **Engineering**: Added a VS Code-free parser adapter and `QueryModel` test suite. The test suite now covers 25+ diagnostics/model cases.
- **Parser spike result**: `@fossiq/kql-lezer` passed the license/size check but failed npm install because its published package references `workspace:*`; 0.9.0 therefore ships the internal parser-adapter fallback.

## 0.8.3

**Trust, schema, and validation depth:**

- **Honest validation scope**: **KQL: Check Syntax** reports that checks are offline heuristics against the bundled schema and do not execute against Azure. Post-save feedback only runs when this extension has no outstanding diagnostics at your configured severity (not other extensions’ squiggles).
- **Optional user schema**: New setting `kqlAssistant.userSchemaPath` — point to a JSON file (same format as `schemas/all-tables.json`) to merge custom tables/columns over the bundled catalog. Reloads when the setting changes.
- **Join key checks**: Single-line `| join … on Column == Column` patterns validate join keys against joined table schemas.
- **Transparency for limited checks**: `lookup`, `mv-expand`, and `project-away` lines emit an **information** diagnostic when full column validation is skipped (so silence is not mistaken for a clean bill of health).
- **Performance**: Diagnostics on edit are debounced (250ms); save still runs an immediate full pass.
- **Engineering**: Unit tests for `KqlSyntaxChecker` and `SchemaStore` (`npm test`); GitHub Actions workflow runs tests on push/PR. Schema loading refactored into `schemaStore.ts` for testability without the VS Code API.
- **Cleanup**: Removed unused per-line `checkBracketBalance` helper (file-level bracket balance remains).

## 0.8.2

**False-positive "Unknown column" fixes:**

- **`project` alias tracking**: Column aliases introduced by `| project Alias = expr` (and `| project-rename`) are now added to the tracked column set, so they are not flagged as unknown in downstream `where`, `summarize`, or `order by` clauses.
- **Multi-line join subquery scope**: After `| join kind=… (…)`, the validator now detects the inner table name even when the subquery spans multiple lines, adds it to the joined-tables set, and extracts any `project`/`extend` aliases defined inside the subquery. Columns from the joined table (e.g. `EmailEvents`) and aliases produced within the subquery (e.g. `EmailTime`) are recognised in all subsequent operators.
- **Skip subquery-internal validation**: Lines inside a multi-line join subquery are no longer checked against the outer query's table — this eliminates false positives for columns that belong to the inner table.
- **Schema revert**: Incorrectly added columns (`OfficeTime`, `EmailTime`, `RecipientEmailAddress`, `NetworkMessageId`, `DeliveryAction`) removed from the `OfficeActivity` schema; the proper fix is behavioural (above), not schema-level.

## 0.8.1

- Documentation: README restructured for the Marketplace (scannable overview, explicit product scope, commands/settings tables, condensed snippets and contributing).
- Historical release notes moved from README into this file.

## 0.8.0

**Schema experience and reliability:**

- **Table completions**: Line-start IntelliSense now offers every table in the bundled `all-tables.json` schema (700+), with table descriptions in the completion detail.
- **Schema-backed hover**: Hover on a known table name for its description; hover on a column name (with table context from scanning the query) for type and description.
- **One schema load on activation**: A single `KqlSchemaValidator` instance is shared by diagnostics, completion, and hover — no duplicate `readFileSync` / JSON parse.
- **Quick fixes**: SQL-style hints now match actual diagnostic messages (`select` / `from` fixes apply when offered). `FROM` fix deletes only the `from ` prefix and keeps the rest of the line. Document-level “unclosed bracket” fixes insert at the end of the file. “Ignore unknown table” appears in the lightbulb menu (placeholder until persistence is added).

## 0.7.3

**CodeLens Improvements:**

- `## Rule ##` headers now show a **· N lines** count of the query body
- `# Category #` headers now show a **· N rules** count of rules inside
- Removed redundant header hover actions (CodeLens covers this now)

## 0.7.2

**New Feature - Inline CodeLens Actions:**

- `## Rule ##` headers now show **Copy Query** and **Select Query** buttons inline
- `# Category #` headers show a **Select All** button inline
- Buttons appear directly on the header line — no hovering needed
- CodeLens updates live as you add or remove headers

## 0.7.1

**Schema Fix:**

- Added missing `AzureActivity` table schema with all 30+ columns
- Fixes false positive errors for `Caller`, `OperationNameValue`, and other AzureActivity columns

## 0.7.0 - "The Query Organization Release"

**New Feature - Query Organization & Folding:**

- **Hierarchical Headers**: Use `# Category #` and `## Rule ##` to organize queries
- **Collapsible Sections**: Fold/unfold entire categories or individual detection rules
- **Select Current Query** command: Place cursor anywhere in a query, run `KQL: Select Current Query` to select the entire block
- **Copy Query on Hover**: Hover over any `## Rule ##` header to see "Copy Query" and "Select Query" actions
- **Enhanced Outline View**: Categories show as Modules, rules show as Detection Rules with proper hierarchy
- **Improved Symbol Provider**: Ranges now extend to include all content until the next header

**New Feature - Feedback Prompt:**

- Added a one-time, non-intrusive feedback prompt to gather user input
- Triggers after successful use: error-free save, syntax check, formatting, copy query, or quick fix
- Three options: "Share Feedback" (opens GitHub Discussions), "Later", or "Don't Ask Again"
- Respects user choice - prompt never reappears after dismissal

## 0.6.4

- Version bump for Marketplace release

## 0.6.3

- Version bump for Marketplace release (no functional changes from 0.6.2)

## 0.6.2

**Critical Bug Fix - Regex Backtracking:**

- **Fixed partial function name matching** - Functions like `iff()`, `bin()`, `toint()`, `strcat()`, `coalesce()` were being partially matched as columns (`if`, `bi`, `toin`, `strca`, `coalesc`)
- Root cause: Regex backtracking when lookahead failed on full function name
- Fix: Changed `(?!\s*\()` to `(?![(\w])` - prevents matching if followed by `(` OR another word character

**Affected patterns fixed:**

- `where` clause column detection
- `project` statement column detection
- `extend` right-side column detection
- `summarize by` column detection

## 0.6.1

**Bug Fixes:**

- **Fixed `union withsource=` syntax** - No longer flags `withsource=SourceTable` as unknown table or invalid assignment
- **Fixed `=~` and `!~` operators** - Case-insensitive equality operators no longer flagged as assignments
- **Fixed function call detection** - Functions like `coalesce()`, `pack()`, `dynamic()` no longer flagged as unknown columns
- **Fixed union table tracking** - All tables in `union Table1, Table2, Table3` now tracked for column validation
- **Added 40+ functions** to skip list: `coalesce`, `pack`, `parse_url`, `hash`, `ipv4_*`, `datetime_*`, etc.

**Technical Changes:**

- Union statements now reset table context and track all listed tables
- `withsource=` parameter properly creates a column (e.g., `SourceTable`)
- Assignment check regex updated: `=(?![=~>])` to exclude comparison operators
- Added negative lookahead `(?!\s*\()` to column patterns to skip function calls
- Extended scalar functions set with 40+ additional common functions

## 0.6.0 - "The Productivity Release"

**Three Major New Features:**

**1. Context-Aware Column Auto-Complete**

- Type after `where`, `project`, `extend`, `summarize`, or `order by` to see column suggestions
- Columns are filtered based on your current table (from 718 Log Analytics schemas)
- Each suggestion shows column type and description
- Sort priority ensures columns appear before functions

**2. Query Formatting**

- Press `Shift+Alt+F` or right-click → "Format Document"
- Automatically formats your KQL with proper pipe indentation, spacing, comma normalization
- Also supports "Format Selection" for partial formatting

**3. Quick Fixes (Code Actions)**

- Click the lightbulb for instant fixes
- SQL-to-KQL migration fixes: `SELECT` → `project`, `ORDER BY` → `order by`
- One-click typo fixes from "Did you mean?" suggestions
- Auto-add missing pipe operators
- Auto-close unclosed brackets

**Technical Changes:**

- New `KqlFormattingProvider` for document formatting
- New `KqlCodeActionProvider` for quick fixes
- Enhanced `KqlCompletionProvider` with schema-aware column suggestions
- Completion provider now loads 718 table schemas for column lookup

## 0.5.6

**Final MV-Expand Assignment Fix:**

- Fixed false positive "Assignment requires extend, summarize..." error in `mv-expand` statements
- Assignments in `mv-expand` (e.g., `DeviceName = DeviceNames`) now properly recognized
- Added `mv-expand`, `mv-apply`, and `lookup` to assignment validation exceptions

## 0.5.5

**Comprehensive Summarize & MV-Expand Fixes:**

- Fixed `count_` column recognition (created by `count()` without assignment)
- Fixed string literal columns in summarize: `["Events Recorded"] = count()`
- Fixed tracking of columns created by `make_set()`, `make_list()` in summarize
- Fixed `mv-expand` column tracking: both `ColName = ArrayCol` and simple `mv-expand ArrayCol`
- Fixed `project-away` operator - now skips validation entirely
- Added automatic column name detection for unassigned aggregations: `sum_`, `avg_`, `max_`, `min_`

## 0.5.4

**Enhanced Operator Support:**

- Added support for `lookup` operator (validation skipped for lookup lines)
- Added support for `mv-expand` and `mv-apply` operators
- Added support for string literals in column names: `["Events Recorded"]`, `['Column Name']`
- Added keywords: `on`, `away` to prevent false positives
- String literals in `summarize` statements no longer flagged as unknown columns

## 0.5.3

**Critical Bug Fix - Multi-line Operator Context:**

- Fixed context bleeding when multi-line operators (project/extend/summarize) weren't properly reset between queries
- Empty lines and markdown headers now correctly reset the multi-line operator flag

## 0.5.2

**Critical Bug Fix:**

- Fixed false detection of random text as table names (e.g., "Useful" in "Useful KQL Queries")
- Table names now require either: valid schema match OR pipe operator following them

## 0.5.1

**Critical Bug Fix:**

- Fixed query context bleeding across multiple queries in the same file
- Each query now properly resets table/column context when separated by blank lines or markdown headers

## 0.5.0

**New Features & Critical Bug Fixes:**

- Fixed false positive error where multi-line `project` statement columns were incorrectly flagged as "Unknown table"
- Added full support for `join` operations - columns from ALL joined tables are now properly validated

## 0.4.21

**Marketplace Display Fix:**

- Fixed README markdown rendering issue in VS Code Marketplace
- Changed title from `# KQL Assistant` to `**KQL Assistant**` for better marketplace compatibility

## 0.4.2

**Bug Fixes:**

- Fixed column validation for multi-line `project` statements
- Fixed validation to track columns created by `extend` and `summarize` operators
- Fixed false positives when using aggregated columns in `sort by` after `summarize`

## 0.4.1

- Added extension icon for VS Code Marketplace

## 0.4.0

**Semantic Analysis & Validation** - Major Intelligence Update

- Schema-Based Table & Column Validation (718+ Log Analytics table schemas, offline)
- Complete Table Schema Library with descriptions and column types
- Intelligent Column Detection with "Did you mean?" typo suggestions

## 0.3.1

- Comprehensive snippet reference in README with complete list organized by category

## 0.3.0

- 30+ Code Snippets, hover documentation, signature help, table and chart completions, 60+ scalar functions

## 0.2.0

- Document outline support for markdown headers

## 0.1.0

- Initial release: syntax highlighting, real-time syntax checking, `.kql` / `.kusto` support, configurable diagnostics
