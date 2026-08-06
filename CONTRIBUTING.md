# Contributing to KQL Assistant

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Reporting Issues

Found a bug or false positive? Please open an issue with:

### For Bugs:
- **Description**: Clear description of the issue
- **KQL Query**: The query that triggered the problem
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Screenshots**: If applicable

### For False Positives:
- **Query**: The KQL query showing the false positive
- **Error Message**: The incorrect error shown
- **Why it's wrong**: Explain why the query is actually valid

## Suggesting Features

Have an idea? Open an issue with:
- **Feature Description**: What you want to add
- **Use Case**: When/why would this be useful
- **Examples**: Show how it would work

## Pull Requests

### Setup
```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/kql-assistant.git
cd kql-assistant
npm install
```

### Development Workflow
1. Create a branch: `git checkout -b feature/your-feature-name`
2. Make changes in `src/` directory
3. Test changes:
   - Compile: `npm run compile`
   - Unit tests: `npm test`
   - Optional KQL lint CLI: `npm run lint:kql -- examples`
   - Press `F5` in VS Code to open Extension Development Host
   - Test with various KQL queries
4. Commit: `git commit -m "Add: clear description"`
5. Push: `git push origin feature/your-feature-name`
6. Open a Pull Request on GitHub

### Testing Your Changes
- Run **`npm test`** before opening a PR; add cases under `test/` for checker, model, lint, packs, snippets, and rule metadata
- For new tables/columns, use `test/fixtures/user-schema.json` as a reference for the JSON shape
- Test with the example files in `examples/` (if present) and your own `.kql` files
- Ensure no false positives are introduced
- Test auto-completion context-awareness
- Verify syntax highlighting works correctly

### Code Style
- Use TypeScript
- Follow existing code patterns
- Add comments for complex logic
- Keep functions focused and small

## Project Structure

```
kql-assistant/
├── src/
│   ├── extension.ts           # Extension entry point
│   ├── diagnostics.ts         # VS Code diagnostics bridge
│   ├── syntaxChecker.ts       # Offline validation + lint integration
│   ├── lintRules.ts           # Detection/cost lint (KQL101–105)
│   ├── queryModel.ts          # Shared query structure model
│   ├── schemaStore.ts         # Schema load, packs, overlays
│   ├── ruleMetadata.ts        # ## Rule ## metadata parsing
│   ├── analyticsRuleExport.ts # Sentinel YAML stub export
│   ├── cli.ts                 # Headless lint CLI
│   └── …Providers.ts          # Completions, hover, format, CodeLens, etc.
├── schemas/
│   ├── all-tables.json        # Bundled Log Analytics / Sentinel catalog
│   ├── asim-parsers.json      # Offline _Im_* ASIM parser stubs
│   └── packs/manifest.json    # Pack → table lists
├── snippets/kql.json
├── test/
├── examples/
└── package.json
```

## Areas Needing Help

### High Priority
- [ ] Reduce remaining false positives in complex expressions / subqueries
- [ ] Better handling of `dynamic` / macros
- [ ] Richer analytics-rule export (entity mappings, data connectors)

### Medium Priority
- [ ] Expand function coverage in completions and signature help
- [ ] Persist “ignore unknown column” (tables already supported via `ignoredTables`)
- [ ] Performance optimizations on very large multi-query files
- [ ] Deeper subquery / project-inside-join column scope

### Future Ideas
- [ ] Fetch / sync schemas from Azure (auth + refresh UX) — keep offline default
- [ ] Query execution integration (opt-in)
- [ ] Additional lint rules / per-rule severity overrides in CI

## Commit Message Guidelines

Use clear, descriptive commit messages:
- `Add: feature description` - New features
- `Fix: bug description` - Bug fixes
- `Update: what changed` - Updates to existing features
- `Docs: documentation changes` - Documentation only
- `Refactor: what was refactored` - Code refactoring

## Questions?

Open an issue with the `question` label!

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
