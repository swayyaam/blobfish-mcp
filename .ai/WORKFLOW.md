# Workflow

Last updated: 2026-05-27

## How we work across sessions

This .ai/ folder is the source of truth between sessions. Before starting any work:
1. Read STATUS.md — know what's in progress and what's next
2. Read ROADMAP.md — know which version you're targeting
3. Read DECISIONS.md — don't relitigate closed decisions
4. Read PRINCIPLES.md — don't violate the non-negotiables

After finishing work in a session:
1. Update STATUS.md — move completed items, add new open questions
2. Update DECISIONS.md — log any new decisions made
3. Update ARCHITECTURE.md — if anything structural changed

## Branch strategy

main — always releasable, matches latest npm version
dev — active development, PRs merge here first

## Version bump process

1. All changes committed and pushed to dev
2. git checkout main && git merge dev
3. npm version patch|minor|major (this commits + tags automatically)
4. git push origin main --follow-tags
5. GitHub Actions publishes to npm automatically on the v* tag

Version semantics:
- patch (x.x.N): bug fixes only, no new features
- minor (x.N.0): new features, backward compatible
- major (N.0.0): breaking changes (config format, removed tools, min Node bump)

## Commit message format

fix: description       — bug fix
feat: description      — new feature
docs: description      — documentation only
ci: description        — CI/CD changes
refactor: description  — no behavior change
chore: description     — maintenance (deps, tooling)

## Release checklist

- [ ] npm test passes (25/25)
- [ ] node --check server.js passes
- [ ] find src -name '*.js' | xargs node --check passes
- [ ] README reflects new features
- [ ] .ai/STATUS.md updated
- [ ] .ai/DECISIONS.md updated with any new decisions
- [ ] No new deps without justification
- [ ] No console.log (only console.error for server logs)
