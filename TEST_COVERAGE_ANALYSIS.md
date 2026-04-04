# Test Coverage Analysis — Two Hearts Resource List

## Current State

| Module | Test file exists | Coverage level | Notes |
|---|---|---|---|
| `src/ResourceList.js` | Yes | ~55% | Several method branches and behaviors untested |
| `src/Validator.js` | Yes | ~50% | `validateZip` entirely untested; edge cases missing |
| `src/Search.js` | **No** | 0% | No test file at all |
| `src/Stats.js` | **No** | 0% | No test file at all |
| `src/Storage.js` | **No** | 0% | No test file at all |

---

## Proposed Improvements

### 1. Write `tests/Search.test.js` (highest priority — 0% coverage)

`Search.js` contains the main data retrieval logic that end users interact with. It has 6 exported functions with several branching paths, none of which are tested.

**What to cover:**

- `searchByKeyword` — empty keyword returns all results; case-insensitivity; matches in `name`, `address`, and `notes` fields; no match returns empty array.
- `filterByCategory` — single category string; array of multiple categories; case-insensitivity; no match.
- `filterActive` — correctly excludes inactive resources; returns all if all are active.
- `sortBy` — ascending and descending; sorts by fields other than `name`; handles missing field values gracefully.
- `paginate` — page 1, middle page, last page; `page` beyond total returns last page; `pageSize` larger than total; `total` and `totalPages` are correct.
- `query` (integration within module) — `activeOnly` default; `keyword` + `categories` combined; pagination applied last.

---

### 2. Write `tests/Stats.test.js` (high priority — 0% coverage)

`Stats.js` produces the summary reports used by coordinators. Bugs here could silently give wrong numbers.

**What to cover:**

- `countByCategory` — correct counts per category; ignores inactive resources; empty list returns `{}`.
- `topCategory` — returns the category with the highest count; returns `null` for an empty list; tie-breaking behavior (whichever comes first is fine, but should be deterministic).
- `addedInLastDays` — counts resources created today; excludes resources older than N days; `days = 0` edge case.
- `summary` — all keys present; `active + inactive === total`; `byCategory` totals match `active` count.
- `findIncomplete` — returns resources missing `phone`; returns resources missing `address`; excludes inactive resources; returns empty when all have full contact info.

---

### 3. Write `tests/Storage.test.js` (high priority — 0% coverage)

`Storage.js` is the only module that touches the filesystem. It needs isolated tests with temp files to avoid side-effects.

**What to cover:**

- `load` — returns `[]` when file doesn't exist; correctly parses a valid JSON array; throws a descriptive error when the file contains invalid JSON; throws when the file contains a non-array (e.g. `{}`).
- `save` — writes valid JSON to disk; creates parent directories automatically; round-trips correctly (save then load returns same data).
- `deleteStore` — deletes an existing file and returns `true`; returns `false` when file doesn't exist.
- **Test isolation:** each test should use a unique temp path (e.g. `os.tmpdir()`) and clean up in `afterEach`.

---

### 4. Fill gaps in `tests/ResourceList.test.js` (~45% branch coverage missing)

**Missing cases:**

| Method | Missing test |
|---|---|
| `add()` | Whitespace-only name throws; leading/trailing whitespace is trimmed from name and category; optional fields default to `null` |
| `update()` | Returns `null` for unknown id; `id` and `createdAt` cannot be overwritten; `updatedAt` timestamp is refreshed |
| `getAll()` | Category filter (case-insensitive); empty list returns `[]` |
| `deactivate()` | Returns `false` for unknown id |
| `reactivate()` | Sets `active: true`; updates `updatedAt`; returns `false` for unknown id |
| `getAllIncludingInactive()` | Returns both active and inactive resources |
| `count()` | Returns 0 on empty list; excludes inactive resources; increases after `add()`, decreases after `remove()` |
| `clear()` | Resets list and id counter |

---

### 5. Fill gaps in `tests/Validator.test.js` (~50% branch coverage missing)

**Missing cases:**

| Function | Missing test |
|---|---|
| `validatePhone` | Empty string `""` (should fail); too-short number like `"123"` |
| `validateCategory` | `null`, `undefined`, empty string, non-string type |
| `validateHours` | Empty string `""` (should fail); `null` (should pass); non-string type |
| `validateZip` | Entirely untested — valid `"12345"`, valid `"12345-6789"`, invalid `"ABCDE"`, invalid `"1234"` (too short), `null`/`undefined` |
| `validateResource` | Multiple simultaneous field errors; invalid hours bubbles up; fully absent object |

---

### 6. Add integration tests in `tests/integration.test.js`

Unit tests verify each module in isolation, but no tests exercise the full workflow:

```
ResourceList.add() → validateResource() → Storage.save() → Storage.load() → query()
```

**Scenarios to cover:**

- Add several resources, save to disk, reload into a new `ResourceList` instance, confirm all resources survive the round-trip.
- Run `query()` after a reload and confirm search/filter still works correctly.
- Attempt to add an invalid resource (validation fails), confirm nothing is persisted.
- Deactivate a resource, save, reload, confirm it remains inactive.

---

## Prioritization

| Priority | Area | Effort | Risk of bug going undetected |
|---|---|---|---|
| P1 | `Search.js` tests | Medium | High — core user-facing feature |
| P1 | `Storage.js` tests | Medium | High — data loss / corruption risk |
| P2 | `Stats.js` tests | Low | Medium — incorrect reporting |
| P2 | `ResourceList.test.js` gaps | Low | Medium — edge-case crashes |
| P3 | `Validator.test.js` gaps | Low | Low — validator is simple |
| P3 | Integration tests | High | Medium — end-to-end correctness |
