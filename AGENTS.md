# Working in this repository

This is a fork of [jdemeul/emdx-photo-frame](https://github.com/jdemeul/emdx-photo-frame). The README's [About this fork](README.md#about-this-fork) section says why it exists and what it plans to add; keep that section's status table current when a change lands.

Project purpose, status, decisions and hardware findings live in memex: project `large-color-eink-frame`, page `pages/projects/large-color-eink-frame.md`, and the open task `epaper-scheduled-image-push`. Read them before starting work, and file what you learn there, not in this repository.

## Upstream

- Remotes: `origin` is this fork, `upstream` is jdemeul's repository. Merge upstream on a branch (`git fetch upstream && git merge upstream/main`) and keep its tests green.
- Keep upstream files close to upstream so merges stay easy: put new behaviour in new modules and hook it in with small, local changes. Do not reformat or restyle upstream code.
- Keep the MIT copyright and permission notice in `LICENSE`.
- `docs/findings.md` is upstream's record of the EM32DX's behaviour on real hardware. Treat it as dated observations, not a full spec.

## Checks

- `npm ci`, then `npm test` (Node's built-in test runner with a fake display in `test/`). One artworks test has failed once and passed on rerun; treat a single failure there as flaky only after a rerun passes.
- Hooks: run `lefthook install` once per clone. Pre-commit runs gitleaks on staged changes and `node --check` on staged `.js` files; pre-push runs gitleaks over the history.
- Never commit `.env`, the display PIN or the web page password.

## Releases

- Pushing a `vX.Y.Z` tag runs [the release workflow](.github/workflows/release-image.yaml), which tests and publishes `ghcr.io/beastyrabbit/emdx-photo-frame:X.Y.Z`. Pull requests and pushes to `main` only test and build.
- The deployment lives in the `kub-homelab` repository, which picks up new tags through Flux image automation. Change deployment settings there, under that repository's rules.
- A release is done when the new version runs in the cluster and the changed flow was checked on the real frame.
