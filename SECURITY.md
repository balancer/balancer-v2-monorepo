# Security policy

## Reporting a vulnerability

Do not open a public issue, pull request, or discussion for a suspected vulnerability in these contracts. Public disclosure before a fix is deployed puts user funds at risk and can affect eligibility under the bounty program's terms.

Report it through the Balancer bug bounty program on Immunefi: https://immunefi.com/bounty/balancer/

The program page is the authoritative source for the assets in scope, the impacts that are rewarded, the reward amounts, and what a submission must contain. Nothing in this file changes those terms, and where this file and the program page differ, the program page governs.

## Scope

Most of Balancer V2 is no longer covered. The program's assets in scope moved to Balancer V3 in June 2026, and what remains from V2 is the part that can still put user funds at risk:

- **The weighted pools**, which are the pool type that still holds meaningful liquidity.
- **The gauges**, which no longer mint BAL but do still receive and distribute third-party incentive tokens.

Everything else in this repository is out of scope, including the parts of the liquidity mining system that governance shut down in late April 2026: BAL minting, the veBAL voting escrow, gauge weight voting, the gauge controller's emission accounting, the fee distributor, and boost delegation.

The V2 core contracts are immutable and cannot be upgraded, so a finding here is generally addressed by migration rather than by a fix to the deployed code.

## What will be closed

The following account for most of what arrives against V2. They are listed here so you can avoid spending time on them.

**Findings whose impact depends on BAL emissions or on a gauge relative weight.** Emissions were halted and the veBAL economics wound down in late April 2026. Gauge relative weights are zero, so an accounting error that scales with a relative weight currently distributes nothing. A report of this shape needs evidence of value at risk as of its own submission date.

**Findings in the veBAL boost math, aimed at the incentives that are still flowing.** The boost does not reach them. A gauge distributes each third-party reward token pro rata by the holder's raw gauge balance against total supply, in `_checkpoint_rewards`, and not by the boosted working balance that the BAL calculation used. An error in the boost accounting therefore has nothing left to misdirect.

**Anything on the BatchRelayer.** The relayer is not among the program's assets in scope. It is also the most repeated V2 submission there is, almost always in the same form: tokens or shares left on a wrapping entry point, claimable by the next caller. Those integrations were never adopted, the current SDK does not expose them, and the affected entry points show no use and hold no balance, so such a report fails on exposure as well as on scope.

**Anything that requires an explicitly malicious pool, router, or rate provider.** The program excludes "vulnerabilities that require the user to interact with explicitly malicious routers, pools, hooks or rate providers", because "introducing such vulnerabilities in a permissionless protocol is both trivial and impossible to prevent". Anyone can deploy a pool, and a hostile one harms only the people who choose to use it. Such a report is in scope only if it demonstrates harm to the Vault or to users outside the attacker's own pool.

**Anything that requires a non-standard ERC20 token.** Tokens with transfer fees, rebasing supply, streaming mechanics, or multiple entry points fall outside the assumptions these contracts are written against.

**Issues already documented as known.** See the published audit reports under `audits/` in this repository.

**Automated scanner or language model output.** A report produced by a scanner or a model, carrying no working proof of concept and no demonstrated impact, will be closed. If the submission links to a fuller writeup, confirm the link resolves before sending it.

**Findings with no path to an exploit.** Gas optimizations, code style, input validation that nothing reachable can violate, concerns about the authority of documented permissioned roles acting within it, and theoretical observations with no concrete route to loss are not vulnerabilities under this program.

## Public issues

A public issue reporting a suspected vulnerability will be closed without triage and redirected to the program above.
