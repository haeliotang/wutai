# Persona and Voice

## Goal

Wutai should feel like a personal computer agent that belongs to the user. The
visual theme, name, voice, and speaking style should be customizable without
turning the product into a toy or weakening the safety model.

## Customizable Attributes

- Assistant name.
- Visual theme.
- Typography and density.
- Voice provider.
- Voice style.
- Speaking speed.
- Default language.
- Tone and directness.
- Work preferences.

## Useful Memory

Persona memory should prioritize work preferences over novelty:

- Preferred output language.
- Default report structure.
- Citation expectations.
- Presentation style.
- File naming conventions.
- Approval preferences.
- Sources the user trusts or dislikes.
- Actions that always require confirmation.

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

## First Version

The first version should support:

- One default text persona.
- A small set of visual themes.
- Optional TTS output through a pluggable provider.
- Basic preference storage.

Advanced persona editing should wait until the task and permission model works.
