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

- `create` or `c` (`accept` and `a` remain aliases): create a new memory;
- `revise` or `v`: create a corrected revision on a specified active memory;
- `reaffirm` or `f`: preserve the target assertion while adding a reaffirming
  revision and the candidate's evidence;
- `contradict` or `x`: create the candidate memory and mark a specified memory
  contradicted by it;
- `supersede` or `u`: create the candidate memory and supersede a specified
  memory with it;
- `ignore` or `i` (`reject` and `r` remain aliases): retain the candidate and
  evidence without creating or changing a memory;
- `skip` or `s`: leave the candidate pending and continue; and
- `quit` or `q`: leave the current and remaining candidates pending and end the session.

Targeted actions require an active memory of the same type in the candidate's
scope. Every resolution is passed to `IngestionService` as actor `user` with
`explicitUserAction: true`. The repository's review-state, protected-memory,
scope, type, and transaction checks remain in force.

Before prompting, the CLI lists available matches with kind, score, matcher ID,
matcher version, and reason. A match is a review aid only: it never chooses a
target or authorizes a merge automatically.

The session ends with counts for accepted, rejected, skipped, and failed decisions. A failure affects only that candidate and does not prevent review of the remaining snapshot.

## Evidence lookup

`IngestionService.getSourceRecord` and the read-only MCP tool `source_record_get` allow inspection when a candidate contains a source-record ID without an excerpt.

The MCP server exposes twenty tools. It exposes no candidate accept or reject tool.

## Boundaries

- The pending list is a snapshot taken when the session begins. Candidates proposed afterward appear in the next session.
- A session reviews at most 100 pending candidates. Skipped candidates remain pending and will appear again.
- The CLI is intended for a trusted local terminal. It may display sensitive source content.
- Bulk review and configurable automation are provided by the separate policy
  CLI and automation service.
- Deterministic normalized equality is always available. Semantic suggestions
  require a separately configured provider implementation.
