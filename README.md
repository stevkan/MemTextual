# MemTextual

![Version](https://img.shields.io/badge/version-0.8.0-blue)
![Status](https://img.shields.io/badge/status-private_evaluation-orange)
![Node.js](https://img.shields.io/badge/Node.js-24.21.0-green)
![Continuity](https://img.shields.io/badge/Continuity-Windows-blue)
![License](https://img.shields.io/badge/license-Proprietary-red)

MemTextual is a local-first memory system for AI agents and personal AI
personas. It gives users direct control over what is remembered, where those
memories are stored, how they change, and which personas or projects may use
them.

Instead of treating memory as an opaque collection of facts controlled by a
model provider, MemTextual keeps evidence, proposed memories, revisions, and
current memory state separate. Memories can be reviewed, corrected, protected,
archived, restored, or permanently removed through explicit controls.

**Current version:** 0.8.0

MemTextual remains under active development and private functional evaluation.
The current version identifies the shared project build; it is not a publicly
supported release.

## Why MemTextual?

Most built-in AI memory features are tied to a particular provider, account, or
application. Users may have limited visibility into why something was
remembered, how it changed, or where it is being used.

MemTextual takes a different approach:

- **Local ownership:** Memories are stored in a local SQLite database under the
  user's control.
- **Evidence and provenance:** A memory can retain the source material and
  candidate that produced it.
- **Inspectable history:** Corrections create revisions instead of silently
  overwriting earlier information.
- **Explicit user control:** Review, protection, deletion, restoration, and
  permanent purge have defined boundaries.
- **Persona isolation:** One user can maintain multiple personas without
  allowing memories to leak between them.
- **Provider-neutral architecture:** Core memory behavior is separated from
  individual AI providers and conversation hosts.
- **Recovery safeguards:** Verified snapshots, restore drills, retention
  policies, and encrypted off-device replication protect the memory database.

MemTextual is intended to complement AI systems rather than replace the models
themselves. It provides the durable memory and control layer around them.

## Editions

### MemTextual Developer

The developer edition provides local memory tools for Codex, local Work, MCP
clients, and project-oriented agent workflows. It supports explicit memory
storage, retrieval, candidate review, lifecycle management, and integration
development.

### MemTextual Continuity

The personal edition is designed for ongoing conversations with one or more
user-created AI personas. It combines persona-bound memory, conversation
capture, review controls, backups, and recovery safeguards.

Continuity currently uses Codex App Server as its initial conversation host. Its
provider-neutral `ConversationHost` boundary allows other supported hosts to be
added later without redefining the memory system.

When MemTextual Continuity is accessed from OpenAI's ordinary ChatGPT client,
passive capture is not guaranteed. OpenAI's supported third-party ChatGPT
interfaces expose [tools that ChatGPT may call](https://developers.openai.com/chatgpt),
but they do not give MemTextual general access to the user's ChatGPT
conversations. Even ChatGPT sign-in explicitly
[does not grant conversation access](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).
As a result, a memory may be captured only when the user explicitly invokes
MemTextual or ChatGPT chooses to call its tools.

The included Continuity client exists to close that gap. Conversations
conducted through the client pass every completed turn through MemTextual's
authorized capture pipeline. Each turn is journaled, capture failures remain
visible, and failed capture can be retried without generating another model
response. This guarantees that completed turns receive a capture attempt; it
does not guarantee that every possible fact will be identified as a memory or
automatically approved for storage.

### MemTextual Core

Both editions share the same storage model, lifecycle rules, privacy boundaries,
and recovery architecture.

## How Memory Works

MemTextual separates four stages:

```text
source evidence -> candidate memory -> memory revision -> current memory state
```

This separation prevents imported text or model-generated interpretations from
automatically becoming trusted memory. Candidates remain pending unless the
user reviews them or has explicitly configured an eligible automation policy.

## Privacy and Control

MemTextual is designed around explicit scope and conservative defaults:

- Memories are restricted to authorized projects, users, or personas.
- Missing sensitivity assessment does not default to normal access.
- Automatic policies cannot bypass protected or high-risk review boundaries.
- Recoverable deletion and permanent purge are separate operations.
- Conversation-host authorization is persona-bound and revocable.
- MemTextual does not silently enable operating-system schedules or cloud
  services.

See [Privacy and deletion](docs/privacy.md) and
[Continuity control](docs/continuity-control.md) for the complete behavior.

## Current Status

- Windows is the initial supported desktop target for Continuity.
- Core compatibility is tracked for Windows, macOS, and Linux.
- Continuity's Windows installer, guided first-run workflow, and lifecycle
  safeguards have passed synthetic validation in network-disabled Windows
  Sandbox environments.
- Production signing, final legal terms, public-release validation, and
  distribution-compliance work are deferred.
- Ordinary ChatGPT does not guarantee passive capture; the included Continuity
  client provides completed-turn capture attempts through an authorized
  conversation-host adapter.

MemTextual should not yet be described as a publicly supported release.

## Getting Started

For the supported setup and first-use workflows, see:

- [Continuity first use](docs/continuity-first-use.md)
- [Developer setup and Codex connection](docs/developer-setup.md)
- [Continuity setup](docs/continuity-setup.md)
- [Technical reference](docs/technical-reference.md)
- [Platform support](docs/platform-support.md)

MemTextual currently requires Node.js 24.21.0 when running from source.

## Documentation

Detailed documentation is available under [`docs/`](docs/), including:

- architecture and memory lifecycle;
- personas and conversation capture;
- candidate review and automation;
- privacy and deletion;
- backups, restore drills, and encrypted replication;
- Windows deployment, installation, upgrades, and removal; and
- migration and release-validation safeguards.

## License and Distribution

MemTextual currently follows a proprietary-first strategy. The source package
is private and marked `UNLICENSED`; no public-use, modification, or
redistribution license is granted.

Final ownership, end-user terms, production signing, third-party notices, and
other public-release requirements must be resolved before public distribution.

See [Proprietary-first distribution](docs/proprietary-distribution.md).
