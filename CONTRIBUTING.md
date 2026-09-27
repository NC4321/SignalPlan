# Contributing

Thanks for your interest. SignalPlan is early and mostly a solo project, but issues and small pull requests are welcome.

## Setup

```sh
pnpm install   # also installs the git hooks
pnpm dev
```

## Workflow

- Branch from `main` and open a pull request; `main` is protected and requires CI to pass.
- Keep pull requests small and focused, with a description of what changed and why.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:` ...). A commit hook checks this.
- Before pushing, run `pnpm check` (typecheck, lint, format check, tests).

## Engine rules

- `packages/engine` must not import React or touch the DOM; it has to run in a Web Worker.
- Every material loss or band constant needs a cited source.
- New behaviour needs a unit test, ideally against a hand-worked case.
