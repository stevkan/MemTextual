# Manual review CLI

## Purpose

The review CLI provides a trusted local interface for deciding whether pending candidates become memories. It uses the explicit-user review path independently of configurable automation.

## Run the review

From the repository:

```powershell
npm run review -- --database .\data\memtextual.db --migrations .\migrations
```

After a production build, the package binary is `memtextual-review` and accepts the same options:

- `--database PATH`
- `--migrations PATH`

The corresponding environment variables and defaults are shared with the MCP entrypoint:

- `MEMTEXTUAL_DB_PATH`, default `memtextual.db`
- `MEMTEXTUAL_MIGRATIONS_DIR`, default `migrations`

## Review flow

The CLI loads up to 100 pending candidates, oldest first. For each candidate it displays:

- assertion and normalized assertion;
- memory type and target scope;
- explicitness, confidence, and proposer;
- retrieval, sensitivity, pinning, and protection controls; and
- every evidence role, source-record identity, author information, exact source content, and selected excerpt when present.

The available actions are:

- `accept` or `a`: request an optional note, create the memory transactionally, and mark the candidate accepted;
- `reject` or `r`: request an optional note, retain the candidate and evidence, and mark it rejected;
- `skip` or `s`: leave the candidate pending and continue; and
- `quit` or `q`: leave the current and remaining candidates pending and end the session.

Every accept or reject action is passed to `IngestionService` as actor `user` with `explicitUserAction: true`. The repository's existing review-state and transaction checks remain in force.

The session ends with counts for accepted, rejected, skipped, and failed decisions. A failure affects only that candidate and does not prevent review of the remaining snapshot.

## Evidence lookup

`IngestionService.getSourceRecord` and the read-only MCP tool `source_record_get` allow inspection when a candidate contains a source-record ID without an excerpt.

The MCP server exposes nineteen tools. It exposes no candidate accept or reject tool.

## Boundaries

- The pending list is a snapshot taken when the session begins. Candidates proposed afterward appear in the next session.
- A session reviews at most 100 pending candidates. Skipped candidates remain pending and will appear again.
- The CLI is intended for a trusted local terminal. It may display sensitive source content.
- Bulk review and configurable automation are provided by the separate policy
  CLI and automation service.
- The CLI performs no candidate deduplication or existing-memory conflict analysis beyond the current repository constraints.
