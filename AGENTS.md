# AGENTS.md

Glossa is a single Analog.js application. Keep the repository simple: no Nx, Turborepo, pnpm workspaces, or separate frontend/backend apps unless the project is explicitly restructured later.

- Use pnpm only. Node must be >= 22.
- Use modern standalone Angular with zoneless change detection, signals, `input()`/`output()`/`model()`, `inject()`, and the new `@if`/`@for`/`@switch` control flow.
- Do not introduce NgModules, Zone.js, `*ngIf`, `*ngFor`, component `BehaviorSubject` state, or manual change detection without a real reason.
- Keep domain logic outside Angular components and HTTP handlers.
- Server routes should parse, call a service/domain operation, and serialize.
- Use ForgeCMS through public npm packages only. Do not copy or link ForgeCMS source.
- ForgeCMS is infrastructure beneath Glossa, not Glossa's external API contract.
- Use Etyma for Glossa application i18n once the requested packages are available; do not create a competing long-term translation runtime.
- Use Tailwind CSS 4 tokens for styling, Volt-style owned UI primitives in `src/app/ui`, Lumen Icons for icons, and Angular Movement for motion.
- Keep UI accessible: semantic HTML, visible focus, good labels, sufficient contrast, and reduced-motion support.
- Add or update meaningful Vitest/Playwright tests with behavior changes.
- Never commit secrets, `.env`, `.dev.vars`, generated build output, coverage, or Playwright reports.
- Run the relevant quality checks before handing work back.
