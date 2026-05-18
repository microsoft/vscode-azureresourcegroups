# Mock Data & Service Mocking Patterns

> Test fixture and mock service patterns. Read during **Step V2** (Mock Implementations).

---

## Mock Data — Key Principles

- Store realistic mock data in `tests/fixtures/` as JSON (e.g., `users.json`, `photos.json`)
- Include `validItems` and `invalidItems` arrays per entity
- Use factory functions for dynamic mock data
- Use stable, predictable IDs (e.g., `user-001`, `photo-001`) so tests reference specific records

### Fixture File Structure

```json
// tests/fixtures/items.json
{
  "validItems": [
    { "id": "item-001", "name": "Widget Alpha", "price": 29.99, "category": "widgets" },
    { "id": "item-002", "name": "Gadget Beta", "price": 49.99, "category": "gadgets" }
  ],
  "invalidItems": [
    { "name": "", "description": "Missing name" },
    { "name": "X", "price": -5, "description": "Invalid price" }
  ]
}
```

### Factory Functions (TypeScript)

```typescript
let counter = 0;
export function createMockItem(overrides?: Partial<Item>): Item {
  counter++;
  return { id: `item-${counter.toString().padStart(3, '0')}`, name: `Test Item ${counter}`, ...overrides };
}
```

> For Python (pytest) and C# (xUnit) fixture patterns, see runtime-specific references in [../../../shared-references/runtimes/](../../../shared-references/runtimes/).

---

## Service Mocking Patterns

> Full mock database implementation (class-based, findAll/findById/findOne/create/update/delete/count/transaction) documented in [../../shared-references/examples/service-abstraction-examples.md](../../shared-references/examples/service-abstraction-examples.md). Use class-based `MockDatabaseService` — not inline function pattern — for consistency.

### Mock Patterns (TypeScript)

**MockDatabaseService**: Map<string, unknown[]> store. Key behaviors:
- `create()`: Preserve caller `id` if present, else generate UUID. Strip auto-managed fields (`createdAt`, `updatedAt`), re-add as timestamps.
- `update()`: Strip auto-managed fields, merge with existing, auto-set `updatedAt`
- `findOne()`: Match all filter key-value pairs
- `transaction()`: Execute callback directly (no real transaction in unit tests)

**MockStorageService**: Map<string, Map<string, Buffer>> store. Upload returns URL, download returns buffer.

**MockAiService** (or other Enhancement services): Return predetermined values. Constructor accepts optional overrides.

### Key Rule: Mock Must Match Concrete

If concrete `create()` strips `id` and generates UUID, mock must either:
- Strip `id` and generate UUID, OR
- Preserve caller `id` (for fixtures) and generate UUID only when `id` missing

Second approach preferred — fixtures use human-readable IDs like `usr-001`.
