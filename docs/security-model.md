# Security Model

## Principle

Wutai should feel like a capable personal computer agent, but it must remain a
permissioned system. The user must be able to understand, approve, stop, and
review what Wutai does.

## Permission Modes

### Observe Mode

Default mode for new users.

Allowed:

- Read explicit user input.
- Read files the user directly provides.
- Show plans and ask questions.

Not allowed:

- Operate mouse or keyboard.
- Read arbitrary folders.
- Open browser sessions.
- Run shell commands.
- Modify files.

### Assist Mode

Task-scoped mode for productive work.

Allowed after approval:

- Read approved files or folders.
- Search public web sources.
- Open browser pages for research.
- Create new artifacts in an approved location.

Still requires confirmation:

- Modifying existing files.
- Sharing private content externally.
- Installing dependencies.
- Sending messages or publishing content.

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

## Audit Trail

Every task should preserve:

- User request.
- Generated plan.
- Permission requests and decisions.
- External sources consulted.
- Artifacts created.
- Human confirmations.
- Runtime errors.
- Final status.

The audit trail should be visible in plain language. Expert logs can be
expanded, but they should not be the primary explanation.

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
