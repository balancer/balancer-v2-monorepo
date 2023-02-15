# Deployment preparation: <!-- Deployment title: contract or feature (e.g. `ManagedPool`) -->

<!-- Specify commit at which `build-info` was generated for this deployment -->

## Deployment preparation tasks checklist:

- [ ] Deployments `README` is updated with the new task name and link
- [ ] Task `README` has a description and links to the artifacts and expected output folders <!-- Specify target networks (some contracts are not deployed to every network) -->
- [ ] `build-info` is updated with artifacts compiled at the specified commit
- [ ] Artifacts are generated from `build-info`
- [ ] New task has a working fork test <!-- This implies index and input scripts are correct -->

## Deprecating old tasks checklist: <!-- Only if applicable -->

- [ ] Old task was moved to `deprecated/` directory
- [ ] Deployments `README` is updated: old task is moved to the 'deprecated' section, and links are updated with the `deprecated/` prefix
- [ ] Old task imports in `index.ts`, `input.ts` and fork tests are updated
- [ ] Old task `README` is updated with a warning sign, a link to the replacement task and a short description <!-- Explain why it was deprecated -->

## Code checklist:

- [ ] The diff is legible and has no extraneous changes <!-- There shouldn't be any changes to code outside of the deployment task in this PR -->
- [ ] Complex code has been commented in tests and scripts
- [ ] Fork test block number and test cases are appropriate for this deployment
- [ ] The base branch is either `master`, or there's a description of how to merge

## Issue Resolution

<!-- If this PR addresses an issue, note that here: e.g., Closes/Fixes/Resolves #1346. -->
