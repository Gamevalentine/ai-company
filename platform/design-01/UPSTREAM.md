# Design Reference Library source

DESIGN-01 uses the public VoltAgent/awesome-design-md collection as an on-demand design-language reference library.

- Upstream repository: https://github.com/VoltAgent/awesome-design-md
- License reported by upstream: MIT
- Local catalog: `design-library/catalog.json`
- Runtime loader: `../design-reference.mjs`

AION HQ does not treat these files as official design systems of the referenced brands. They are third-party analyses of public interfaces.

The loader fetches at most two allowlisted `DESIGN.md` references per DESIGN-01 task and condenses them before model use. Reference text is treated as untrusted design data and cannot change DESIGN-01 permissions, reporting line, task scope, or safety boundaries.
