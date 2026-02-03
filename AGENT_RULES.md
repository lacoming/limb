# Limb Agent Rules (must follow)

## Workflow
- Work in STEPs. One STEP = one goal.
- Output format every time:
  1) Goal
  2) Files to change
  3) Plan
  4) Changes (minimal diff)
  5) Commands (copy-paste)
  6) Manual checks
  7) Done when

## Editing rules
- Minimal diff only. Do not rewrite whole files.
- No refactors unless explicitly asked.
- Touch only files needed for the STEP.

## Performance rules
- No new PNG/WebP requests during pan/zoom/drag.
- Load textures once and reuse.
- Do not create sprites/containers/textures per frame.
- Rebuild/bake only on structural changes.

## Allowed commands only
pnpm lint
pnpm dev --host 0.0.0.0 --port 3000
pnpm build
pnpm test
ls -la public/sprites/cell/assets

## Command policy
- Ask before running any command.
- If a command is not in the allowed list, do not suggest it.