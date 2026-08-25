# Contributing

Thanks for helping build Glossa. The project is early, so small, well-tested changes are preferred.

## Development

Use Node >= 22 and pnpm 10.30.1.

```bash
pnpm install
pnpm dev
```

## Quality

Before opening a pull request, run the checks relevant to your change:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use Playwright for browser/API smoke coverage when routing, SSR, or user-visible behavior changes.

## Architecture

Keep Glossa product/domain logic out of Angular components and API route handlers. Use ForgeCMS only through public npm APIs and keep it as infrastructure beneath Glossa.
