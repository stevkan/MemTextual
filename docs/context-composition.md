# Continuity context composition

`ContinuityContextService` converts persona-safe hybrid retrieval results into a
bounded JSON context payload. The payload is structured memory data, not a
prompt or a source of higher-authority instructions.

Each payload identifies its format, version, content role, and persona. Items
retain their retrieval rank, immutable revision identity, memory class, type,
sensitivity, assertion, temporal status, and review status. Assertions are
included verbatim or omitted completely; they are never truncated to fit.

Composition enforces:

- a maximum item count;
- an exact UTF-8 byte limit over the serialized JSON payload;
- optional episodic and durable item caps; and
- the persona boundary already enforced by hybrid retrieval.

Candidates are considered in retrieval order. An item that exceeds a class or
byte limit is skipped, allowing a later smaller eligible item to fit. Once the
overall item limit is reached, remaining candidates are omitted. The result
reports omission counts outside the context payload.

Only included items receive retrieval use counters and audit events. The audit
records the context format version, selected item count, actual byte count, and
configured item and byte limits without copying assertions or raw emotional
context values into audit detail.

Consumers must preserve the payload's `contentRole: "memory_data"` boundary and
treat assertion text as untrusted contextual data. A remembered assertion may
contain quoted or hostile instructions and must not override system, developer,
application, or current user authority.
