# Database Integrity Patterns

> Schema constraints, transactions, and indexes — database is last line of defense against data corruption.

---

## Core Principle

**Application-level checks are necessary but insufficient.** Database schema must enforce correctness even under concurrent access. Race conditions, partial failures, and unexpected input can bypass application logic — database constraints must catch what code misses.

---

## Rule: Constraints Are Mandatory in Migrations

Every migration MUST include appropriate constraints. Do not rely solely on application-level validation.

### UNIQUE Constraints

Any field that must be unique across the table (email, username, slug, invite token) MUST have database-level UNIQUE constraint.

```sql
-- Application-level check alone is NOT sufficient (race condition under concurrent requests)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,            -- ← REQUIRED: prevents duplicate registration race condition
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  couple_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Why application-level checks fail:**
```
Request A: SELECT WHERE email = 'alice@test.com' → not found → INSERT
Request B: SELECT WHERE email = 'alice@test.com' → not found → INSERT  ← Both succeed!
```

With UNIQUE constraint, second INSERT fails with constraint violation, which error handler maps to 409 Conflict.

### Foreign Key Constraints

Any field referencing another table MUST have FK constraint with explicit ON DELETE behavior.

```sql
CREATE TABLE photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES couples(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_url TEXT NOT NULL,
  thumbnail_url TEXT,
  caption TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| ON DELETE Behavior | When to Use |
|-------------------|-------------|
| `CASCADE` | Child records deleted when parent deleted (photos when couple deleted) |
| `SET NULL` | Child remains but loses reference (user.couple_id when couple dissolved) |
| `RESTRICT` | Prevent parent deletion if children exist (user can't be deleted if they own photos) |

### CHECK Constraints

Business rules expressible as column constraints should be enforced at database level:

```sql
ALTER TABLE pairing_invites
  ADD CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'rejected'));

ALTER TABLE users
  ADD CONSTRAINT valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
```

### Partial UNIQUE Constraints

When UNIQUE constraint should only apply to rows matching a condition (e.g., prevent duplicate *pending* invites but allow multiple *rejected* ones), use PostgreSQL **partial unique index**:

```sql
-- Prevent duplicate pending invites from the same user to the same email
CREATE UNIQUE INDEX idx_unique_pending_invite
  ON invites(from_user_id, to_email) WHERE status = 'pending';
```

> ⚠️ **Application-level checks are NOT sufficient** for partial uniqueness — concurrent requests can both pass `findOne` check and both INSERT. Database constraint is defense-in-depth layer preventing this race condition. Always include partial UNIQUE indexes in migrations when plan specifies them.

### NOT NULL

Default to `NOT NULL`. Use `NULL` only when absence of value is a meaningful business state:

| ✅ Nullable (meaningful absence) | ❌ Should be NOT NULL |
|----------------------------------|----------------------|
| `user.couple_id` (unpaired user) | `user.email` |
| `photo.thumbnail_url` (not yet generated) | `photo.blob_url` |

---

## Rule: Transactions for Multi-Table Writes

Any operation that writes to 2+ tables MUST use database transaction. Without transaction, failure mid-sequence leaves database in inconsistent state.

### IDatabaseService Transaction Method

Add to database service interface:

#### TypeScript

```typescript
// services/interfaces/IDatabaseService.ts
export interface IDatabaseService {
  findAll<T>(collection: string, options?: QueryOptions): Promise<T[]>;
  findById<T>(collection: string, id: string): Promise<T | null>;
  findOne<T>(collection: string, filter: Record<string, unknown>): Promise<T | null>;
  create<T>(collection: string, data: T): Promise<T>;
  update<T>(collection: string, id: string, data: Partial<T>): Promise<T | null>;
  delete(collection: string, id: string): Promise<boolean>;
  count(collection: string, filter?: Record<string, unknown>): Promise<number>;
  healthCheck(): Promise<boolean>;

  // Execute multiple operations atomically — all succeed or all rollback
  transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T>;
}
```

#### Python

```python
# services/interfaces/database_service.py
from typing import Protocol

class IDatabaseService(Protocol):
    # ... existing methods ...

    async def transaction(self, fn) -> any:
        """Execute fn within a database transaction. fn receives a transactional
        IDatabaseService instance. If fn throws, all changes are rolled back."""
        ...
```

#### C#

```csharp
// Services/Interfaces/IDatabaseService.cs
public interface IDatabaseService
{
    // ... existing methods ...

    Task<T> TransactionAsync<T>(Func<IDatabaseService, Task<T>> fn);
}
```

### Concrete Implementation (PostgreSQL)

```typescript
// services/database.ts
async transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  try {
    await client.query('BEGIN');
    // Create a transaction-scoped service that uses this client instead of the pool
    const trxService = new TransactionDatabaseService(client);
    const result = await fn(trxService);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

### Mock Implementation

```typescript
// tests/mocks/mockDatabase.ts
async transaction<T>(fn: (trx: IDatabaseService) => Promise<T>): Promise<T> {
  // Mock transactions execute callback directly against in-memory state.
  // For most tests this is sufficient — transaction boundary tested
  // via integration tests with real database.
  return fn(this);
}
```

### Usage in Handlers

```typescript
// BAD — 4 sequential writes with no atomicity
const couple = await database.create('couples', { ... });
await database.update('users', user1Id, { coupleId });
await database.update('users', user2Id, { coupleId });
await database.update('pairing_invites', inviteId, { status: 'accepted' });

// GOOD — all-or-nothing transaction
const couple = await database.transaction(async (trx) => {
  const couple = await trx.create('couples', {
    id: uuid(),
    user1Id: invite.fromUserId,
    user2Id: userId,
    createdAt: new Date().toISOString(),
  });
  await trx.update('users', invite.fromUserId, { coupleId: couple.id });
  await trx.update('users', userId, { coupleId: couple.id });
  await trx.update('pairing_invites', inviteId, { status: 'accepted' });
  return couple;
});
```

---

## Rule: Indexes on Frequently Queried Columns

Migrations should include indexes for columns used in:
- `WHERE` clauses (filter queries)
- `JOIN` conditions
- `ORDER BY` clauses
- Foreign keys

```sql
-- Foreign keys used in WHERE/JOIN
CREATE INDEX idx_photos_couple_id ON photos(couple_id);
CREATE INDEX idx_invites_to_email ON pairing_invites(to_email);
CREATE INDEX idx_invites_from_user ON pairing_invites(from_user_id);

-- Composite indexes for common query patterns
CREATE INDEX idx_invites_lookup ON pairing_invites(to_email, status);
```

---

## Rule: Handle Constraint Violations in Error Handler

When database rejects operation due to constraint violation, map to appropriate HTTP error:

### TypeScript

```typescript
// In errorHandler.ts — add constraint violation handling
if (error instanceof Error && error.message?.includes('duplicate key')) {
  return {
    status: 409,
    jsonBody: {
      error: {
        code: 'CONFLICT',
        message: 'A record with this value already exists',
        details: null,
      },
    },
  };
}

if (error instanceof Error && error.message?.includes('violates foreign key')) {
  return {
    status: 400,
    jsonBody: {
      error: {
        code: 'BAD_REQUEST',
        message: 'Referenced record does not exist',
        details: null,
      },
    },
  };
}
```

---

## Planning Checkpoint

During Phase 1 planning, project plan MUST include **Database Constraints** section:

```markdown
## Database Constraints

| Table | Constraint Type | Column(s) | Detail |
|-------|----------------|-----------|--------|
| users | UNIQUE | email | Prevent duplicate registration |
| users | FK | couple_id → couples.id | ON DELETE SET NULL |
| photos | FK | couple_id → couples.id | ON DELETE CASCADE |
| photos | FK | uploaded_by_user_id → users.id | ON DELETE CASCADE |
| photos | INDEX | couple_id | Filter photos by couple |
| pairing_invites | CHECK | status | IN ('pending', 'accepted', 'rejected') |
| pairing_invites | FK | from_user_id → users.id | ON DELETE CASCADE |
| pairing_invites | INDEX | to_email, status | Invite lookup |
```

---

## Testing Database Integrity

```typescript
describe('database constraints', () => {
  it('should reject duplicate email registration', async () => {
    // First registration succeeds
    await database.create('users', { id: uuid(), email: 'alice@test.com', ... });

    // Second registration with same email should fail
    await expect(
      database.create('users', { id: uuid(), email: 'alice@test.com', ... })
    ).rejects.toThrow();
  });

  it('should cascade delete photos when couple is deleted', async () => {
    const photos = await database.findAll('photos', { filter: { coupleId } });
    expect(photos).toHaveLength(3);

    await database.delete('couples', coupleId);

    const remaining = await database.findAll('photos', { filter: { coupleId } });
    expect(remaining).toHaveLength(0);
  });
});
```
