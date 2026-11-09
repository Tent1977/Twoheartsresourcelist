# CLAUDE.md — Two Hearts Resource List

This file documents the codebase for AI assistants working in this repository.

## Project Overview

**Two Hearts Resource List** is a JavaScript/Node.js library for managing community resources (food banks, shelters, clinics, etc.) for Two Hearts Community Aid. It is a pure Node.js library with no runtime dependencies — only Jest for testing.

## Repository Structure

```
Twoheartsresourcelist/
├── package.json                 # Node project config; Jest test runner
├── CODING_SUMMARY.md            # Historical session summary and coverage notes
├── TEST_COVERAGE_ANALYSIS.md    # Coverage gap analysis from initial audit
├── src/
│   ├── index.js                 # Entry point; re-exports all modules
│   ├── ResourceList.js          # Core: add/remove/update/deactivate resources
│   ├── Validator.js             # Input validation (phone, category, hours, ZIP)
│   ├── Search.js                # Keyword search, filter, sort, paginate
│   ├── Stats.js                 # Counts, summaries, incomplete-record finder
│   └── Storage.js               # JSON file-based persistence (save/load/delete)
└── tests/
    ├── ResourceList.test.js     # Full coverage of ResourceList class
    ├── Validator.test.js        # Full coverage of all validators
    ├── Search.test.js           # Full coverage of search/filter/sort/paginate
    ├── Stats.test.js            # Full coverage of stats utilities
    ├── Storage.test.js          # Full coverage of file I/O (uses real temp files)
    └── integration.test.js      # End-to-end: save → load → query → stats pipeline
```

## Source Modules

### `src/ResourceList.js`
The main class. Manages an in-memory list of resources.

- `add(resource)` — adds a resource; requires `name` and `category`; auto-assigns `id`
- `remove(id)` — hard-deletes a resource
- `getById(id)` — returns one resource or `null`
- `update(id, fields)` — patches fields; protects `id` and `createdAt`
- `deactivate(id)` — soft-delete (sets `active: false`)
- `reactivate(id)` — re-enables a deactivated resource
- `getAll(category?)` — returns active resources, optionally filtered by category
- `getAllIncludingInactive()` — returns all including inactive
- `count()` — count of active resources
- `clear()` — wipes list and resets id counter

### `src/Validator.js`
Pure validation functions; each returns `{ valid: boolean, error: string|null }`.

- `validatePhone(phone)` — optional field; accepts `null`/`undefined`; rejects empty string
- `validateCategory(category)` — must match one of 10 allowed values (see `VALID_CATEGORIES`)
- `validateHours(hours)` — optional; rejects empty string if provided
- `validateZip(zip)` — optional; US ZIP format only (`12345` or `12345-6789`)
- `validateResource(resource)` — runs all validations; returns `{ valid, errors[] }`
- `VALID_CATEGORIES` — exported array: `food`, `shelter`, `clothing`, `healthcare`, `mental-health`, `transportation`, `employment`, `education`, `legal`, `other`

**Known quirk:** `validatePhone('')` returns valid because the guard is `!phone`. Empty string is treated as "not provided." If distinguishing absent from empty matters, the source needs an explicit `phone === ''` check.

### `src/Search.js`
Pure functions (no side effects).

- `searchByKeyword(resources, keyword)` — case-insensitive match across `name`, `address`, `notes`
- `filterByCategory(resources, categories)` — filter by one or more category strings
- `filterActive(resources)` — returns only `active: true` resources
- `sortBy(resources, field, direction)` — sort ascending/descending by any field
- `paginate(resources, page, pageSize)` — returns `{ items, total, page, totalPages }`
- `query(resources, options)` — combined pipeline: activeOnly → keyword → category → sort → paginate

### `src/Stats.js`
Reporting utilities.

- `countByCategory(resources)` — `{ food: 5, shelter: 3, ... }` (active only)
- `topCategory(resources)` — category name with the highest count
- `addedInLastDays(resources, days)` — count of resources added in last N days
- `summary(resources)` — full metrics: total, active, inactive, byCategory, mostCommon
- `findIncomplete(resources)` — active resources missing `phone` or `address`

### `src/Storage.js`
File system persistence using JSON.

- `load(filePath?)` — reads JSON array; returns `[]` if file absent
- `save(resources, filePath?)` — writes JSON; creates parent dirs automatically
- `deleteStore(filePath?)` — deletes the file; returns `true`/`false`
- `DEFAULT_PATH` — `<cwd>/data/resources.json`

## MCP Server — Connecting Apps to Claude

This library ships as an **MCP (Model Context Protocol) server** (`src/mcp-server.js`). Any app that supports MCP — including Claude Desktop, Claude Code, and apps built with the Anthropic SDK — can connect to this server and manage community resources through natural language without writing custom integration code.

### Quickstart

```bash
npm install          # installs @modelcontextprotocol/sdk
npm run start:mcp    # launches the MCP server on stdio
```

### Connecting to Claude Desktop

Add this block to your Claude Desktop config file
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "twohearts-resources": {
      "command": "node",
      "args": ["/absolute/path/to/Twoheartsresourcelist/src/mcp-server.js"]
    }
  }
}
```

Restart Claude Desktop. Claude will now have access to the community resource tools.

### Connecting via the Anthropic SDK (programmatic)

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const { spawn } = require('child_process');

const client = new Anthropic();

// Point the SDK at the MCP server process
const response = await client.beta.messages.create({
  model: 'claude-opus-4-5',
  max_tokens: 1024,
  tools: [],   // tools come from the MCP server via the SDK's MCP support
  mcp_servers: [{
    type: 'stdio',
    command: 'node',
    args: ['./src/mcp-server.js'],
  }],
  messages: [{ role: 'user', content: 'List all food resources and show me the stats.' }],
});
```

Apps that already connect to Claude via the API need only add the `mcp_servers` field — no other changes required.

### Exposed MCP Tools

| Tool | Description |
|---|---|
| `list_resources` | All active resources; optional category filter |
| `search_resources` | Keyword + category filter with sort and pagination |
| `get_resource` | Single resource by ID |
| `add_resource` | Create a new resource (validates before saving) |
| `update_resource` | Patch fields on an existing resource |
| `deactivate_resource` | Soft-delete (preserves history) |
| `reactivate_resource` | Re-enable a deactivated resource |
| `remove_resource` | Permanent delete |
| `get_stats` | Summary: total, active/inactive, by-category, recently added |
| `find_incomplete_resources` | Active records missing phone or address |
| `validate_resource` | Check a resource object without saving it |

### Data persistence

The MCP server loads from and saves to `data/resources.json` (relative to `cwd`) using the same `Storage` module the rest of the library uses. All mutations auto-save.

---

## Development Workflow

### Running Tests

```bash
# Install dependencies (first time only)
npm install

# Run all tests with coverage
npm test

# Run in watch mode during development
npm run test:watch
```

### Test Coverage Targets

Coverage thresholds are enforced in `package.json` at 70% for all metrics. Current coverage exceeds that:

| File | Statements | Branches | Functions | Lines |
|---|---|---|---|---|
| `ResourceList.js` | 100% | 100% | 100% | 100% |
| `Validator.js` | 100% | 100% | 100% | 100% |
| `Search.js` | 100% | 95% | 100% | 100% |
| `Stats.js` | 100% | 82% | 100% | 100% |
| `Storage.js` | 100% | 73% | 100% | 100% |

### Adding a New Feature

1. Add logic to the appropriate `src/` module (or create a new one and export from `src/index.js`).
2. Add/extend the corresponding test file in `tests/`.
3. Run `npm test` and confirm coverage stays above thresholds.
4. If adding a new module, add it to `src/index.js` exports and `package.json`'s `collectCoverageFrom`.

## Coding Conventions

- **CommonJS modules** — all files use `module.exports` / `require()`. Do not introduce ES module syntax (`import`/`export`).
- **No runtime dependencies** — keep `dependencies` in `package.json` empty. Testing tools only go in `devDependencies`.
- **Pure functions in Search/Stats** — these modules must remain side-effect free; do not add I/O or mutation.
- **Validation is separate from storage** — `validateResource()` and `ResourceList.add()` are intentionally decoupled. Callers validate first; `add()` only checks for `name` and `category` presence.
- **Soft-delete pattern** — prefer `deactivate()` over `remove()` when data preservation matters.
- **Error handling** — `ResourceList` throws on missing required fields (`add()`); all other methods return `null`/`false` on not-found rather than throwing.
- **Timestamps** — `createdAt` and `updatedAt` are ISO strings set via `new Date().toISOString()`. Tests that verify timestamp updates should use Jest fake timers to avoid millisecond-precision flakiness.

## Known Open Items

1. **Validation not wired to `add()`** — `validateResource()` is not called inside `ResourceList.add()`. Callers must validate separately. Consider wiring them to prevent invalid records from being stored.
2. **No linter configured** — ESLint has not been set up. Adding it would catch style and logic issues automatically.
3. **No CLI** — coordinators must use the library programmatically. A `src/cli.js` could expose common operations as terminal commands.

## Branch Naming

Feature branches follow the pattern `claude/<short-description>-<id>`. The primary development branch for this codebase is based on `claude/analyze-test-coverage-xVHkm`.
