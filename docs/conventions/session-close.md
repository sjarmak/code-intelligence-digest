# Session close — "Landing the Plane"

Failure modes covered: in-progress beads left open without resolution; remaining work falling through the cracks; quality-gate skipped commits landing on main; root directory accumulating session artifacts; uncommitted state lost on next session.

## 1. Check in-progress beads

```bash
bd list --json | jq '.[] | select(.status == "in_progress") | {id, title}'
```

For each: verify test exists, runs, and produces no regressions. Close ONLY if all criteria met. Otherwise keep `in_progress` and file what remains.

## 2. File remaining work

```bash
bd create "Remaining task" -t task -p 2
```

Include enough context that a fresh agent can pick it up cold.

## 3. Run quality gates

```bash
npm test -- --run          # the --run flag is mandatory (no watch mode)
npm run lint
unset NODE_ENV && npm run build
```

## 4. Clean root directory

```bash
ls -1 | grep -E "\.(md|txt|json|sh)$" | grep -v -E "^(README|AGENTS|LICENSE|package|tsconfig|next|eslint|postcss)"
# Move any results to history/
```

## 5. Commit and sync

```bash
git add .
git commit -m "Session close: <summary>"
git pull --rebase
```

## 6. Clean git state

```bash
git stash clear
git remote prune origin
git status
```

## 7. Report to user

- Closed / open beads with status
- New issues filed
- Test / lint / build results
- Recommended next-session work prompt
