# Legacy-memory migration

## Purpose

The trusted local `memtextual-migrate` CLI imports memories retained by an
earlier agent or memory system without treating them as already approved:

```text
legacy export -> source records -> pending candidates -> explicit review -> memories
```

Every imported entry becomes one source record and one candidate. Importing the
export creates no memory. The user must accept candidates through
`memtextual-review` or an explicit bulk-review command before they become
retrievable.

## Export format

The importer accepts UTF-8 JSON with `formatVersion` 1:

```json
{
  "formatVersion": 1,
  "source": {
    "title": "Previous agent memories",
    "originSystem": "Legacy Agent",
    "externalId": "legacy-agent-export-2026-10-12",
    "originUri": "https://example.invalid/export/123",
    "exportedAt": "2026-10-12T12:00:00Z",
    "metadata": {
      "exportVersion": 2
    }
  },
  "memories": [
    {
      "id": "legacy-memory-1",
      "assertion": "The user prefers TypeScript.",
      "type": "preference",
      "authorRole": "user",
      "explicitness": "explicit",
      "confidence": 1,
      "observedAt": "2026-01-02T03:04:05Z",
      "metadata": {
        "originalCategory": "preference"
      }
    }
  ]
}
```

Required source fields are `title`, `originSystem`, and a stable `externalId`.
Each memory requires a stable `id` and nonempty `assertion`. Entry IDs must be
unique within the export. An entry may provide `scopeId`; otherwise the CLI
requires `--scope ID`. Source-record content preserves the assertion text
exactly; the candidate assertion follows normal candidate whitespace
normalization. Every referenced scope must exist before the migration begins.

Optional entry fields are:

- `type`: any supported memory type;
- `normalizedAssertion`;
- `explicitness`: `explicit` or `inferred`;
- `confidence`: from 0 through 1;
- `observedAt` and `createdAt`;
- `retrievalPolicy`: `include`, `exclude`, or `manual`;
- `sensitivity`: `normal`, `sensitive`, or `restricted`;
- `isPinned` and `isProtected`;
- `authorRole` and `authorName`; and
- arbitrary JSON `metadata`.

## Conservative defaults

Omitted fields default to:

| Field | Default |
| --- | --- |
| `type` | `other` |
| `explicitness` | `inferred` |
| `confidence` | `0.5` |
| `retrievalPolicy` | `include` |
| `sensitivity` | `normal` |
| `isPinned` | `false` |
| `isProtected` | `false` |

Every candidate is proposed by the `import` actor and carries
`requiresManualReview: true`. This prevents configured automation from silently
approving legacy assertions. Supplying `authorRole: "user"` or
`explicitness: "explicit"` preserves claimed provenance for inspection but
does not bypass review.

## Run the migration

```powershell
npm run migrate -- --file .\legacy-memories.json --scope PROJECT_SCOPE_ID --database .\data\memtextual.db --migrations .\migrations
```

The compiled package binary is `memtextual-migrate`. The command prints a JSON
summary containing the source ID, candidate IDs, current candidate statuses,
and created-versus-reused counts. It never prints source contents.

After importing, review pending candidates:

```powershell
npm run review -- --database .\data\memtextual.db --migrations .\migrations
```

## Idempotency and conflicts

The source `externalId` and each memory `id` form stable migration identities.
Rerunning the same export reuses its source, records, and candidates, including
their current accepted or rejected states. It does not create duplicates or
reopen reviewed candidates.

Reusing a source or candidate identity with different content fails instead of
overwriting provenance. Changed exports require a new source `externalId`.

## Current limitations

- The importer accepts the MemTextual JSON format; vendor-specific export
  adapters are not included.
- Acceptance always creates a new memory. Semantic duplicate detection,
  conflict matching, merging, revision, reaffirmation, contradiction, and
  supersession choices are not automated.
- Source version relationships, resumable streaming imports, deletion, and
  privacy-purge workflows are not implemented.
