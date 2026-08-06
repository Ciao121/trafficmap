# Permanent Development Rules

## Language

- Conversations with the user, clarifications, operational updates, and final reports must be written in Italian.
- Everything that belongs to the repository must be written in English, including code, code comments, function names, variable names, file names, user interface messages, error messages, the README, the changelog, technical documentation, GitHub and CI files, example configurations, test names and descriptions, and any new repository files.

## Development Tool Neutrality

- No versioned file may state or imply which development tools were used to create the software.
- Do not include references to the user's personal development process.
- The README, changelog, code, comments, tests, configurations, documentation, and GitHub files must remain neutral regarding the tools used for development.
- This file may contain generic operational instructions for a development agent, but it must not name specific assistants, vendors, or describe the origin of the software.

## Start of Every New Session

Before modifying code, read `AGENTS.md`, `README.md`, `CHANGELOG.md`, `package.json`, all tests, and all affected modules in full. Then run:

```bash
npm ci
npm run verify
```

If the baseline fails, report it before attributing the problem to new changes.

## Version Management

Each future session corresponds exclusively to the version specified by the user. Update the version in `package.json`, keep `package-lock.json` consistent, add the corresponding section to `CHANGELOG.md`, update the README when usage changes, and update `config.example.json` when configuration changes. Do not modify versions other than the one requested.

## Regression Tests

Every new or corrected behavior must have permanent automated tests. For every bug, add a test that reproduces the regression whenever possible. Run the complete suite before finishing. Existing tests are permanent functional requirements and must not be deleted, skipped, disabled, artificially weakened, or reinterpreted without an explicit request.

## Scope of Changes

Do not introduce unrequested changes, rewrite unrelated components, change protocols or data formats, move or rename files, or add unnecessary dependencies. Do not modify `config.json` or `data/geoip-cache.json`. Do not create automatic installation procedures or resident process configurations. Do not perform commits, pushes, pulls, tags, releases, or other remote operations without an explicit request.

## Completion of Every Version

Always run:

```bash
npm run verify
npm run test:coverage
```

The final report must state the completed version, verified previous behavior, added or corrected functionality, created/modified/deleted files, added tests, executed regression tests, complete results, coverage, remaining limitations, and confirmation that no unrequested Git operations were performed.
