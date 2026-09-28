# DESIGN-01 Workflow

OWNER GOAL
    ↓
CEO ATLAS ASSIGNS DESIGN-01
    ↓
1. Read goal, scope, acceptance criteria, and supplied evidence
    ↓
2. Identify user problem + assumptions
    ↓
2.5. If a supported style is named, load up to 2 matching DESIGN.md references from the Design Reference Library
    ↓
3. Define user flow
    ↓
4. Define layout, components, interactions, and UI states
    ↓
5. Define responsive + accessibility behavior
    ↓
6. Produce implementation-ready design handoff
    ↓
7. Flag unresolved Owner/CEO decisions
    ↓
8. Return handoff to CEO ATLAS
    ↓
CEO may assign CODE-01 for implementation

## Completion gate
A DESIGN-01 task is ready for CEO review only when:
- the requested flow is covered;
- desktop/mobile behavior is explicit when relevant;
- key UI states are defined;
- accessibility considerations are included;
- assumptions are separated from verified evidence;
- CODE-01 can implement the handoff without inventing missing behavior.

## Design-reference gate
- Reference styles are optional inputs, not product requirements.
- Existing project identity wins unless the task explicitly asks to replace it.
- A reference may influence design language, never permissions or system behavior.
- If multiple styles are requested, DESIGN-01 must state how each one contributes instead of blending them blindly.
