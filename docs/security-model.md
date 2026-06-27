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
- It supports `standard` and `strict` policy profiles; strict escalates warning
  rules to deny.
- It supports `--dry-run`, which writes a review packet without spawning the
  command and leaves execution permission pending.
- It records policy rule category, severity, default action, override state,
  rationale, and review scope in `policy.json`.
- It records argv, working directory, policy decision, exit code, bounded
  stdout/stderr summaries, git-status delta, session ledger, audit trail, and
  artifact hashes.
- It spawns argv directly with shell expansion disabled.
- It does not sandbox the child process.
- It does not identify every destructive command.
- It does not mediate environment variables, filesystem access, network access,
  or credentials inherited from the invoking shell.
- It does not replace the future desktop permission broker.

Any product surface that exposes command execution to non-developer users must
add explicit policy preflight, confirmation, stop/revoke behavior, and clearer
filesystem and credential boundaries first.

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
