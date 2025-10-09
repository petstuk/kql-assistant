<div align="center">
  <img src="icon.png" alt="KQL Assistant Logo" width="128"/>

  **KQL Assistant**

  A Visual Studio Code extension that provides Kusto Query Language (KQL) syntax checking, highlighting, and language support.
</div>

---

## Features

- **Syntax Highlighting**: Full syntax highlighting for KQL queries with support for:
  - Keywords and operators
  - Aggregation and scalar functions
  - String literals and numbers
  - Comments (line and block)
  - Data types

- **Syntax Checking**: Real-time syntax validation that detects:
  - Unmatched brackets, parentheses, and braces
  - Unclosed string literals
  - Incorrect pipe operator usage
  - Common SQL-to-KQL migration mistakes (e.g., using `SELECT` instead of `project`)
  - Missing operators for assignments
  - Query structure issues

- **Language Configuration**: 
  - Auto-closing brackets and quotes
  - Comment toggling support
  - Code folding regions

- **Document Outline**: 
  - Markdown headers in KQL files appear in the Outline view
  - Supports `#` through `######` header levels
  - Navigate quickly through sections of your queries

- **Code Snippets**: 
  - 30+ pre-built query templates
  - Common patterns: time filters, aggregations, joins, security queries
  - Type prefix (e.g., `timerange`, `failedlogins`) and press Tab to insert
  - See full list in Usage section below

- **Hover Documentation**: 
  - Hover over functions and operators for instant documentation
  - Detailed syntax, parameters, and examples
  - No need to leave your editor

- **Parameter Hints**: 
  - IntelliSense shows function parameters as you type
  - Highlights current parameter
  - Supports 100+ KQL functions

- **Enhanced Auto-completion**: 
  - 27 common Azure tables (SecurityEvent, SigninLogs, etc.)
  - 12 chart types for render operator
  - 60+ additional scalar functions
  - Context-aware suggestions

- **Semantic Analysis** (NEW in v0.4.0):
  - Validates table and column names against 718 Log Analytics schemas
  - Detects unknown tables/columns with "Did you mean?" suggestions
  - Real-time validation as you type
  - Schema-based validation from official Microsoft documentation
  - Works completely offline

## Installation

### From VS Code Marketplace (Recommended)

1. Open Visual Studio Code
2. Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X` on Mac)
3. Search for "KQL Assistant"
4. Click "Install"

Or install directly from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=petstuk.kql-assistant)

### From Source

1. Clone or download this repository
2. Navigate to the extension directory:
   ```bash
   cd kql-assistant
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Compile the TypeScript code:
   ```bash
   npm run compile
   ```

5. Install the extension:
   - Press `F5` in VS Code to open a new Extension Development Host window
   - Or package and install:
     ```bash
     npm run package
     code --install-extension kql-assistant-0.5.6.vsix
     ```

## Usage

1. Open any file with `.kql` or `.kusto` extension
2. The extension will automatically activate and provide syntax highlighting
3. Syntax errors will be underlined in real-time as you type

### 📋 Organizing Multiple Queries in One File

When working with multiple queries in a single `.kql` or `.kusto` file, the extension tracks each query's context separately. To ensure proper validation, **separate your queries** using one of these methods:

- **Markdown headers** ⭐ **Recommended** - Use `## Header ##` to organize query sections
- **Comment line** - Use `//` comments to separate queries  
- **Blank line** - Leave an empty line between queries

**Best Practice Example:**
```kql
## User Identity Query ##

IdentityInfo
| where AccountUPN contains "user@domain.com"
| project AccountUPN, AccountDisplayName


## Security Log Query ##

CommonSecurityLog
| where TimeGenerated > ago(1d)
| project TimeGenerated, SourceIP, DestinationIP
```

> **💡 Pro Tips:**
> - Always use markdown headers (`##`) for file titles and section names
> - Each query automatically resets its table and column context
> - Never start your file with plain text (use `## Title ##` instead)

### Code Snippets

Type a snippet prefix and press `Tab` to insert a template. Available snippets:

**Time & Filtering:**
- `timerange` - Filter by time range with ago()
- `timebetween` - Filter by specific date range
- `topn` - Get top N results
- `distinct` - Get distinct values
- `wherein` - Multiple OR conditions using 'in'
- `contains` - String contains filter

**Aggregations & Analysis:**
- `agg` - Basic aggregation with count by field
- `timeseries` - Time series aggregation with chart
- `percentile` - Percentile analysis (P50, P95, P99)
- `errorcount` - Count errors by type

**Joins & Unions:**
- `join` - Inner join two tables
- `leftjoin` - Left outer join
- `union` - Combine multiple tables

**Variables & Statements:**
- `let` - Define scalar variable
- `lettable` - Define table variable
- `extend` - Add multiple computed columns
- `project` - Select specific columns

**Security Queries:**
- `failedlogins` - Failed login attempts analysis
- `suspiciouslogin` - Successful logins after failed attempts
- `emailsecurity` - Email security analysis
- `signinanalysis` - Azure AD sign-in failure analysis
- `securityalerts` - Security alert summary

**Parsing & Data Manipulation:**
- `parsejson` - Parse JSON field and extract properties
- `parse` - Parse custom log format
- `mvexpand` - Expand multi-value array
- `extract` - Extract data using regex

**Azure-Specific:**
- `perfcounter` - Performance counter analysis
- `heartbeat` - Computer heartbeat/availability check
- `ipanalysis` - IP address analysis

**Advanced Patterns:**
- `rownumber` - Window function with row_number()
- `makeseries` - Create time series with make-series
- `case` - Multi-condition case statement

*Start typing any prefix and press Tab to insert the full query template!*

### Hover for Help

Hover your mouse over any KQL function or operator to see:
- Detailed description
- Syntax and parameters
- Usage examples

### Parameter Hints

When typing a function, you'll see parameter hints:
```kql
bin(TimeGenerated, 1h)
    ^^^^^^^^^^^^^^  ^^^
    Shows which parameter you're entering
```

### Manual Syntax Check

You can manually trigger a syntax check using the command palette:
1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type "KQL: Check Syntax"
3. Press Enter

## Configuration

The extension provides the following settings:

- `kqlAssistant.enableDiagnostics`: Enable or disable syntax checking (default: `true`)
- `kqlAssistant.diagnosticLevel`: Set the severity level for diagnostics:
  - `error` (default): Show diagnostics as errors
  - `warning`: Show diagnostics as warnings
  - `information`: Show diagnostics as information

To configure these settings:
1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "KQL Assistant"
3. Adjust settings as needed

## Example KQL Queries

```kql
// Simple query with filtering
StormEvents
| where State == "TEXAS"
| project StartTime, EventType, DamageProperty
| take 10

// Aggregation query
StormEvents
| summarize EventCount = count(), TotalDamage = sum(DamageProperty) by State
| order by TotalDamage desc

// Time-based analysis
StormEvents
| where StartTime >= ago(30d)
| extend Month = startofmonth(StartTime)
| summarize count() by Month, EventType
| render timechart
```

## Supported KQL Features

### Keywords
`and`, `as`, `by`, `extend`, `join`, `project`, `summarize`, `where`, `order`, `sort`, `take`, `limit`, `union`, and more

### Aggregation Functions
`count`, `sum`, `avg`, `min`, `max`, `dcount`, `percentile`, `make_list`, `make_set`, and more

### Scalar Functions
`ago`, `datetime`, `format_datetime`, `substring`, `split`, `parse_json`, `tostring`, `toint`, `tolower`, `toupper`, and more

## Known Limitations

- Join column validation across tables not yet fully implemented
- Complex query validation with subqueries is limited
- Function parameter type validation is basic
- Custom table schemas (workspace-specific tables) not yet supported
- Column validation in join conditions coming in future release

## 🤝 Contributing

**Contributions are very welcome!** This extension is actively being improved and your input is valuable.

### How to Contribute

1. **Report Issues**: Found a bug or false positive error? [Open an issue](../../issues/new) with:
   - A description of the problem
   - The KQL query that triggered it
   - Expected vs actual behavior

2. **Suggest Improvements**: Have ideas for new features or better auto-completion? [Create an issue](../../issues/new) with:
   - Feature description
   - Use case examples
   - Why it would be helpful

3. **Submit Pull Requests**: Want to fix something yourself?
   - Fork the repository
   - Create a feature branch (`git checkout -b feature/YourFeature`)
   - Make your changes
   - Test thoroughly in the Extension Development Host
   - Commit with clear messages (`git commit -m 'Add: feature description'`)
   - Push to your branch (`git push origin feature/YourFeature`)
   - Open a Pull Request

### Areas for Improvement

Help is especially welcome in these areas:
- **Reducing false positives** in syntax checking
- **Adding more KQL functions** to auto-completion
- **Field name suggestions** (context-aware column names)
- **Schema validation** (checking if tables/columns exist)
- **Query formatting** (prettify KQL queries)
- **Performance optimizations**
- **Documentation improvements**

### Development Setup

```bash
git clone https://github.com/petstuk/kql-assistant.git
cd kql-assistant
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

## 📄 License

MIT License - feel free to use this extension in your projects.

## 🙏 Acknowledgments

Built with research from official [KQL documentation](https://learn.microsoft.com/en-us/kusto/query/) and community best practices.

## Release Notes

### 0.5.6

**Final MV-Expand Assignment Fix:**
- Fixed false positive "Assignment requires extend, summarize..." error in `mv-expand` statements
- Assignments in `mv-expand` (e.g., `DeviceName = DeviceNames`) now properly recognized
- Added `mv-expand`, `mv-apply`, and `lookup` to assignment validation exceptions

### 0.5.5

**Comprehensive Summarize & MV-Expand Fixes:**
- Fixed `count_` column recognition (created by `count()` without assignment)
- Fixed string literal columns in summarize: `["Events Recorded"] = count()`
- Fixed tracking of columns created by `make_set()`, `make_list()` in summarize
- Fixed `mv-expand` column tracking: both `ColName = ArrayCol` and simple `mv-expand ArrayCol`
- Fixed `project-away` operator - now skips validation entirely
- Added automatic column name detection for unassigned aggregations: `sum_`, `avg_`, `max_`, `min_`

**Technical Details:**
- Enhanced summarize parsing to detect default column names (`count_`, `sum_`, etc.)
- Added string literal column extraction: `/\["([^"]+)"\]\s*=/gi`
- Improved mv-expand column tracking with assignment and simple forms
- project-away now skips validation like lookup and mv-expand

### 0.5.4

**Enhanced Operator Support:**
- Added support for `lookup` operator (validation skipped for lookup lines)
- Added support for `mv-expand` and `mv-apply` operators
- Added support for string literals in column names: `["Events Recorded"]`, `['Column Name']`
- Added keywords: `on`, `away` to prevent false positives
- String literals in `summarize` statements no longer flagged as unknown columns

**Technical Changes:**
- Multi-line operator tracking now includes `lookup`, `mv-expand`, `mv-apply`
- String literals removed from validation (`/\["[^"]+"\]/g` and `/\['[^']+'\]/g`)
- Lookup and mv-expand lines skipped entirely (too complex for current validation)

### 0.5.3

**Critical Bug Fix - Multi-line Operator Context:**
- Fixed context bleeding when multi-line operators (project/extend/summarize) weren't properly reset between queries
- Empty lines and markdown headers now correctly reset the multi-line operator flag
- This fixes the issue where columns from the first query were incorrectly validated against subsequent queries

### 0.5.2

**Critical Bug Fix:**
- Fixed false detection of random text as table names (e.g., "Useful" in "Useful KQL Queries")
- Table names now require either: valid schema match OR pipe operator following them
- Improved file organization: markdown headers now properly recommended as best practice
- Updated documentation with clear examples of proper query separation

**Documentation Updates:**
- Added "Best Practice" example showing proper file organization with markdown headers
- Emphasized using `## Header ##` format for file titles and section names
- Added pro tips: never start files with plain text, always use markdown headers

### 0.5.1

**Critical Bug Fix:**
- Fixed query context bleeding across multiple queries in the same file
- Each query now properly resets table/column context when separated by blank lines or markdown headers
- Previously, columns from the first query's table were incorrectly validated against subsequent queries' tables
- Improved detection of new query starts: now recognizes queries after empty lines, comments, or markdown headers

### 0.5.0

**New Features & Critical Bug Fixes:**
- Fixed false positive error where multi-line `project` statement columns (e.g., `SourceUserName`) were incorrectly flagged as "Unknown table"
- Added full support for `join` operations - columns from ALL joined tables are now properly validated
- Fixed validation to check columns across all joined tables instead of just the primary table
- Improved multi-line operator detection to prevent continuation lines from being misidentified as table names
- Enhanced error messages for joined queries to show all relevant table names

**Technical Details:**
- Implemented join tracking with `joinedTables` Set to maintain schema context across join operations
- Fixed regex pattern for table detection to exclude indented continuation lines
- Updated column validation to check columns in any of the joined tables
- Join regex now handles various join syntaxes: `| join kind=leftouter (TableName)` and `| join TableName`

### 0.4.21

**Marketplace Display Fix:**
- Fixed README markdown rendering issue in VS Code Marketplace
- Changed title from `# KQL Assistant` to `**KQL Assistant**` for better marketplace compatibility

### 0.4.2

**Bug Fixes:**
- Fixed column validation for multi-line `project` statements
- Fixed validation to track columns created by `extend` and `summarize` operators
- Fixed false positives when using aggregated columns (e.g., `TotalEmailsInPastThirtyDays`) in `sort by` after `summarize`
- Enhanced query pipeline tracking to understand column schema changes through the query
- Improved handling of continuation lines in project/summarize statements

### 0.4.1

- Added extension icon for VS Code Marketplace

### 0.4.0

**Semantic Analysis & Validation** - Major Intelligence Update

- **NEW**: Schema-Based Table & Column Validation
  - Validates against 718 Log Analytics table schemas
  - Extracted from official Microsoft documentation
  - Detects unknown/misspelled table names (e.g., `SecurityEvents` → `SecurityEvent`)
  - Detects unknown/misspelled column names (e.g., `ComputrName` → `Computer`)
  - "Did you mean?" suggestions for typos
  
- **NEW**: Complete Table Schema Library
  - All Log Analytics, Azure Monitor, and Microsoft Sentinel tables
  - Includes table descriptions and all column definitions
  - Column types, names, and descriptions for every table
  - Works completely offline - no Azure connection needed
  - Schemas sourced from Microsoft Learn documentation

- **NEW**: Intelligent Column Detection
  - Validates columns in `where`, `project`, `extend`, `summarize`, and `order by` clauses
  - Tracks table context through query pipeline
  - Smart suggestions for similar column names
  - Levenshtein distance matching for typo detection

### 0.3.1

- Comprehensive snippet reference in README with complete list organized by category
- Clear usage instructions for each snippet prefix
- Helps users discover all 30+ available templates

### 0.3.0

Productivity enhancements:
- 30+ Code Snippets for common query patterns
- Hover Documentation for 100+ operators and functions
- Signature Help (Parameter Hints) for function parameters
- Azure Table Auto-completion (27 common tables)
- Render Chart Types auto-completion (12 chart types)
- 60+ additional scalar functions (network, encoding, geospatial, arrays, etc.)

### 0.2.0

- Document outline support for markdown headers
- Headers (`#`, `##`, `###`, etc.) appear in the Outline view with hierarchical navigation
- Fixed false positive errors for "from" keyword in markdown headers

### 0.1.0

Initial release:
- Basic syntax highlighting
- Real-time syntax checking
- Support for .kql and .kusto files
- Common error detection
- Configurable diagnostics

