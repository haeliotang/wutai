# Persona and Voice

## Goal

Wutai should feel like a local supervision console that belongs to the user.
Visual theme, name, voice, and speaking style may be customizable later, but
they are secondary to permissions, evidence, artifacts, and auditability.

## Customizable Attributes

- Assistant name.
- Console name.
- Visual theme.
- Typography and density.
- Voice provider.
- Voice style.
- Speaking speed.
- Default language.
- Tone and directness.
- Work preferences.

## Useful Memory

Preference memory should prioritize review and work preferences over novelty:

- Preferred output language.
- Default report structure.
- Citation expectations.
- Presentation style.
- File naming conventions.
- Approval preferences.
- Sources the user trusts or dislikes.
- Actions that always require confirmation.
- Evidence thresholds that should trigger review.

## Voice Boundary

Voice should be optional. Wutai must work fully through text.

If future builds support user-provided reference voices, the product must
require explicit rights and consent. Voice identity is sensitive and should not
be treated as a casual theme asset.

## Safety Boundary

A persona may change wording, pacing, and presence. It may not override:

- Permission requirements.
- Confirmation requirements.
- Audit logging.
- High-risk action blocks.
- Data handling policy.
- Human-attested review requirements.

## First Version

The first version should support:

- One default text persona.
- A small set of visual themes.
- Basic preference storage.

Voice and advanced persona editing should wait until the supervised-session,
permission, and evidence models work.
