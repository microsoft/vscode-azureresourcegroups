# Project Plan

**Status**: Approved
**Created**: 2026-09-03
**Mode**: NEW

---

## 1. Project Overview

**App Type**: API only

A small task tracker: a Node API, Blob Storage for attachments, and PostgreSQL for
task records.

---

## 2. Services Required

| Azure Service | Role in App | Environment Variable | Default Value (Local) | Classification |
|---------------|------------|---------------------|----------------------|----------------|
| Blob Storage | Task attachments | `STORAGE_CONNECTION_STRING` | `UseDevelopmentStorage=true` | Essential |
| PostgreSQL | Task records | `DATABASE_URL` | `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/tasksdb` | Essential |

---

## 3. Prerequisites

### Run

| Tool | Service(s) | Installed | Version |
|------|-----------|-----------|---------|
| Node.js | * | ✅ | v22.11.0 |
| npm | * | ✅ | 10.9.0 |

### Debug

| Tool | Service(s) | Installed | Version |
|------|-----------|-----------|---------|
| Docker | api | ❓ | — |

> ⚠️ **Action required:** Confirm any tool or extension marked ❓ is installed.

---

## 4. Planned Access Model

Sketched here so it can be reviewed before any infrastructure is generated. The deploy
agent owns the real templates; this is the shape it should produce.

This section is why the fixture exists in this form: it is a *plan document* that quotes
infrastructure, which is the case `check-phase-reachability.ts` reasons about. The
scanner is content-based and reads fenced code, so these blocks are scanned exactly as a
`.bicep` file would be.

```bicep
resource attachmentsReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, api.id, 'blob-data-reader')
  scope: storage
  properties: {
    // Least privilege: read-only, scoped to the one storage account the API needs.
    roleDefinitionName: 'Reader'
    principalId: api.identity.principalId
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'sttasktracker'
  properties: {
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}
```

Secrets stay in Key Vault and are referenced, never inlined:

```
STORAGE_KEY = @Microsoft.KeyVault(SecretUri=https://kv-tasktracker.vault.azure.net/secrets/storage-key/)
```

---

## 5. Next Steps

Approve this plan to scaffold the API.
