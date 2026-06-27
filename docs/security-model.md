# Security Model

## Principle

Wutai should feel like a local trust boundary around agentic work. The user
must be able to understand, approve, stop, and review what agents did through
Wutai.

## Permission Modes

### Observe Mode

Default mode for new users.

Allowed:

- Read explicit user input.
- Read files the user directly provides.
- Show plans and ask questions.
- Import or display already-generated artifacts when the user selects them.

Not allowed:

- Operate mouse or keyboard.
- Read arbitrary folders.
- Open browser sessions.
- Run shell commands.
- Modify files.

The development CLI wrapper is outside the default Observe Mode UI. It runs
only when a developer explicitly invokes `npm run wutai:run -- -- <command>`.

### Assist Mode

Task-scoped mode for productive work.

Allowed after approval:

- Read approved files or folders.
- Search public web sources.
- Open browser pages for research.
- Create new artifacts in an approved location.
- Grant a runtime task-scoped access to an approved provider or credential
  purpose.

Still requires confirmation:

- Modifying existing files.
- Sharing private content externally.
- Installing dependencies.
- Sending messages or publishing content.
- Passing a long-lived credential to an external runtime that Wutai cannot
  mediate.

### Delegate Mode

Future mode for long-running computer tasks.

Allowed after strong approval:

- Operate browser or desktop apps within task scope.
- Run multi-step workflows.
- Continue until blocked or completed.

Always requires explicit confirmation:

- Payments and purchases.
- Email, chat, social posting, or external submissions.
- Destructive file operations.
- Credential access.
- System settings changes.

## High-risk Actions

These actions must be blocked unless a specific confirmation flow exists:

- Delete, overwrite, move, or publish user files.
- Send any message as the user.
- Submit forms containing personal data.
- Install software or browser extensions.
- Change operating system settings.
- Access secrets, keys, wallets, passwords, or credential stores.
- Start network listeners.
- Run destructive shell commands.
- Export audit logs or artifacts containing private local paths or sensitive
  source material.

## Local Command Boundary

The v0.2 developer CLI wrapper can execute an explicitly supplied local command
and create a work packet. Its current boundary is structured but incomplete:

- It runs a structured but incomplete policy preflight before execution.
- It denies matched high-risk rules by default, unless the caller passes
  `--allow-high-risk`.
- It loads profile behavior from `config/wutai-cli-policy-profiles.json`, or
  from an explicit `--policy-config <path>`.
- It supports `standard` and `strict` policy profiles; strict escalates warning
  rules to deny.
- It supports rule-level overrides inside the loaded profile. Overrides can
  strengthen or weaken individual rules and are recorded in `policy.json`.
- It supports `--dry-run`, which writes a review packet without spawning the
  command and leaves execution permission pending.
- The desktop/web packet review surface can record dry-run approve or deny into
  local `review.json`; that record does not spawn, sandbox, or supervise the
  command.
- It records policy rule category, severity, default action, override state,
  rationale, and review scope in `policy.json`.
- It records argv, working directory, policy decision, exit code, bounded
  stdout/stderr summaries, git-status delta, session ledger, audit trail, and
  artifact hashes.
- With `--signing-key <pem>`, it writes optional `attestation.json` that signs
  the final `manifest.json` bytes with ECDSA P-256 SHA-256 and embeds the public
  key needed for verification.
- The desktop/web import path writes `provenance.json` for manifest hash,
  producer fields, required artifact presence, schema-kind consistency, and
  optional signature/attestation verification. Missing signatures remain a
  warning. Valid signatures remain untrusted unless the public key hash matches
  a local trusted-producer policy explicitly loaded or enrolled by the user.
- When a packet attestation verifies but the key is unknown, the UI can enroll
  that public key hash into local trusted-producer policy for the observed
  producer adapter and packet type, then recompute `provenance.json`.
- The local trust registry can revoke or reactivate enrolled/loaded keys and
  export the current policy. Revoked matching keys block trusted provenance
  until reactivated by the user.
- It spawns argv directly with shell expansion disabled.
- It does not sandbox the child process.
- It does not identify every destructive command.
- It does not mediate environment variables, filesystem access, network access,
  or credentials inherited from the invoking shell.
- It does not protect the signing key or prove the private-key holder is a
  trusted Wutai producer.
- Local key enrollment is a trust decision by the current user. It is not
  certificate-chain validation, remote identity proof, or remote revocation
  checking.
- It does not implement certificate-chain validation, remote revocation checks,
  system keychain-backed trust storage, or automatic key enrollment.
- It does not make external policy configs safe by default; a local config can
  intentionally downgrade a rule and must be treated as trusted input.
- It does not replace the future desktop permission broker.

Any product surface that exposes command execution to non-developer users must
add explicit policy preflight, confirmation, stop/revoke behavior, and clearer
filesystem and credential boundaries first.

## Coding-Agent Trace Import Boundary

The coding-agent trace importer accepts a declared `wutai.coding_agent_trace`
JSON file and converts it into a local `coding_agent` work packet.

- It records declared tool calls, file changes, credential purposes, runtime
  summary, audit trail, and artifact hashes.
- It does not execute, replay, approve, or block the external coding agent.
- It does not prove the imported trace is complete or authentic.
- It does not capture file diffs or contents unless the trace declares them.
- It does not mediate credentials, filesystem access, network access, or tool
  permissions for the external agent session.

Use this as post-hoc review evidence only. It is not live supervision.

## MCP Tool-Call Trace Import Boundary

The MCP tool-call trace importer accepts a declared
`wutai.mcp_tool_call_trace` JSON file and converts it into a local
`mcp_tool_call` work packet.

- It records declared MCP server/tool names, request summaries, bounded
  argument previews, result summaries, resources, credential purposes, audit
  trail, and artifact hashes.
- It rejects malformed traces such as missing required tool names, invalid trace
  status, invalid timestamp order, negative latency, or overlarge tool-call
  batches before creating a local task.
- It does not proxy the MCP connection, execute tools, approve or block tool
  calls, replay requests, or verify the trace is complete.
- It does not mediate credentials, filesystem access, network access, or MCP
  server permissions.

Use this as post-hoc review evidence only. It is not a live MCP permission
broker.

## Local File Ingestion Boundary

Local file ingestion reads only files explicitly selected by the user through
the file picker and converts them into a local `local_file` work packet.

- It records file name/path labels, MIME type, size, SHA-256, bounded text
  preview, file-read audit entries, and artifact hashes.
- It limits ingestion to a bounded batch size and bounded per-file size before
  hashing or previewing content.
- It can re-check a local file packet by comparing newly selected files against
  the recorded SHA-256 and byte size, then saving `file-check.json`.
- It does not crawl directories, watch future file changes, retain full file
  contents, or grant file access to a downstream agent.
- It does not prove that the selected files are still unchanged after import;
  later verification requires re-importing or comparing the recorded hash.

Use this as a bounded evidence-ingestion path only. It is not a general
filesystem permission broker.

## Credential Boundary

Agents should not receive broad permanent credentials by default. Wutai should:

- Store long-lived provider keys in the system keychain or equivalent secure
  store.
- Scope credential use by profile, provider, purpose, task, and session.
- Prefer short-lived or delegated access where a provider supports it.
- Record which credential purpose was used without storing the secret value in
  task history or artifacts.
- Redact known secret values before logs, errors, or audit payloads leave the
  backend boundary.

When an external runtime requires raw credentials and Wutai cannot enforce a
task-scoped boundary, the adapter must be marked experimental and hidden from
the default path.

## Audit Trail

Every task should preserve:

- User request.
- Generated plan.
- Permission requests and decisions.
- Credential purposes granted or denied.
- External sources consulted.
- Artifacts created.
- Human confirmations.
- Runtime errors.
- Final status.
- Evidence verification and known blind spots when applicable.

The audit trail should be visible in plain language. Expert logs can be
expanded, but they should not be the primary explanation.

## Evidence Boundary

Evidence checks are a review surface, not an oracle. Wutai may classify source
tiers, calculate citation coverage, flag high-risk claims, and preserve
supporting metadata. It must not present those checks as a guarantee that every
statement in an artifact is true.

Human alignment and accountability records must be explicit human acts. An
agent can prepare the review surface; it must not ghost-write the user's final
attestation.

## Stop and Revoke

The UI must include:

- A visible stop control during active tasks.
- A way to revoke task permissions.
- A way to inspect currently granted permissions.
- A way to delete local task history and artifacts.

## External Runtimes

Adapters must not inherit unrestricted access by default. If an external
runtime needs access to files, browser, shell, or desktop control, Wutai should
grant it only through the task permission scope.

When an external runtime cannot enforce Wutai's permission boundary, that
runtime must be marked experimental and hidden from the default non-technical
user path.
