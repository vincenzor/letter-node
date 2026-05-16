# Publishing `@letterapp/node`

Internal release notes. Not shipped with the package.

## One-time setup

You need an npm account that's a member of the `letterapp` org. The org has to
exist *before* you can publish to it — npm only auto-creates a scope when it
matches your username.

```bash
# 1. Log in to npm.
npm login

# 2. Create the `letterapp` org (one-time, free for public packages).
#    There is no CLI for free org creation; do it via the web UI:
#    https://www.npmjs.com/org/create
#    - Name: letterapp
#    - Plan: Free (Open source)
```

Manage members afterwards at <https://www.npmjs.com/settings/letterapp/members>.

## Cutting a release

```bash
# 1. Bump the version. While at 0.x, the wire format is still unstable —
#    minor for new methods/options, patch for fixes, major only at 1.0.
npm version patch   # or: minor / major

# 2. Inspect what's about to ship. `prepublishOnly` runs the build for you.
#    --no-git-checks here because dry-run doesn't actually publish; the
#    clean-tree guard only matters for the real run.
pnpm publish --dry-run --no-git-checks

#    Confirm the tarball contains only:
#      - dist/index.js
#      - dist/index.d.ts
#      - dist/index.js.map + dist/index.d.ts.map
#      - README.md
#      - LICENSE
#      - package.json

# 3. Commit the version bump. pnpm's real publish refuses to ship with a
#    dirty tree — what's on npm should match a commit in git.
git add package.json
git commit -m "v$(node -p "require('./package.json').version")"

# 4. Publish for real.
pnpm publish

# 5. Push the commit + the tag npm version created.
git push --follow-tags
```

`publishConfig.access: "public"` makes scoped publishes public by default;
npm otherwise requires an explicit `--access public`.

## Versioning policy

While the wire format is pre-1.0:

- **patch** (`0.1.0 → 0.1.1`) — bug fixes, doc tweaks, no public surface change
- **minor** (`0.1.0 → 0.2.0`) — new options/methods, behavior changes, anything
  a careful consumer might want to read release notes for
- **major** (`0.x → 1.0.0`) — only once the HTTP API and method signatures are
  considered stable

Keep `SDK_VERSION` in `src/index.ts` in sync with `package.json` — it's sent
as `User-Agent` so we can grep server logs for outdated clients.

## What lives where

| File                 | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `src/index.ts`       | Single source file. All public exports live here.  |
| `dist/`              | Build output. Created by `pnpm build`. Shipped on publish; gitignored. |
| `tsconfig.json`      | Dev / typecheck config — `noEmit: true`.           |
| `tsconfig.build.json`| Publish build — `NodeNext`, emits to `dist/`, generates `.d.ts` + maps. |
| `package.json`       | `main`/`types`/`exports` point at `dist/` (consumed via npm install). |
| `README.md`          | npm landing page.                                  |
| `LICENSE`            | MIT.                                               |
