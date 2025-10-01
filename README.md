# KQL Assistant

A Visual Studio Code extension that provides Kusto Query Language (KQL) syntax checking, highlighting, and language support.

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

## Installation

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
     code --install-extension kql-assistant-0.1.0.vsix
     ```

## Usage

1. Open any file with `.kql` or `.kusto` extension
2. The extension will automatically activate and provide syntax highlighting
3. Syntax errors will be underlined in real-time as you type

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

- Advanced semantic analysis is not yet implemented
- Complex query validation across multiple tables is limited
- Function parameter validation is basic

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

### 0.1.0

Initial release:
- Basic syntax highlighting
- Real-time syntax checking
- Support for .kql and .kusto files
- Common error detection
- Configurable diagnostics

