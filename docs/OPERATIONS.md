# Operations runbook

This runbook covers current local operations. Wikai does nothing automatically: release builds,
deployment, rollback, slug release and revision garbage collection require explicit commands.
Reports, plan hashes, receipts and deployment evidence are private and must not be published.

All examples use an explicit configuration path. The state and deployment operations documented
below are read-only unless they contain `--apply`; their apply form requires the exact `planHash`
from a newly reviewed plan and either an interactive `yes` or `--yes`. The release build is a
separate confirmed mutation using `--yes`. If evidence changes, an expected hash is rejected.
Generate and review a new plan instead of retrying the stale hash.

## Configure a local destination

Only local directory deployment is implemented. Configure each environment explicitly:

```yaml
deployments:
  production:
    type: directory
    root: ../deployments/production
```

Environment names contain letters, digits, `_` or `-` and must begin with a letter or digit.
Relative roots resolve from the configuration file. Use a dedicated destination outside the vault,
publisher state, staging, site source and dist. An unknown environment fails with
`DEPLOYMENT_NOT_CONFIGURED`; there is no implicit production destination or remote-provider fallback.

## Build and audit the exact release

```bash
docker build -t wikai-site:local site
npm run wiki-pub -- --config publisher.config.yaml build --release --yes
npm run wiki-pub -- --config publisher.config.yaml audit --json
```

The isolated build regenerates approved-only staging, renders without network/private mounts,
audits the result, promotes `site.distDir`, and records private build evidence in
`publisher.stateDir/release-input.json` and `release-receipt.json`. The receipt binds exact approved
revision hashes, redirects, staging policy and the complete dist fingerprint. Do not edit dist,
active publication state, policy files or the receipt between build and deployment.

## Deploy a reviewed generation

Plan first:

```bash
npm run wiki-pub -- --config publisher.config.yaml \
  deploy directory production --json
```

Confirm that `environment`, `source`, `destination`, revision map and diagnostics are expected and
that `canApply` is true. Then apply that exact plan:

```bash
npm run wiki-pub -- --config publisher.config.yaml \
  deploy directory production --apply \
  --expected-hash sha256:REPLACE_WITH_REVIEWED_PLAN_HASH --yes --json
```

Apply repeats all plan checks, copies dist into a temporary sibling, verifies an exact fingerprint,
audits the copy, and atomically promotes it. The prior destination becomes `<root>.previous`.
Matching immutable policy/receipt evidence is retained privately per environment; deployment state
is recorded only after destination and evidence promotion succeed. A failure restores the prior
generation and does not claim deployment success.

## Roll back to the retained generation

Rollback targets only the exact `<root>.previous` generation with matching private evidence:

```bash
npm run wiki-pub -- --config publisher.config.yaml deploy rollback production --json
npm run wiki-pub -- --config publisher.config.yaml deploy rollback production \
  --apply --expected-hash sha256:REPLACE_WITH_REVIEWED_PLAN_HASH --yes --json
```

The plan validates current and previous fingerprints/policies and audits the previous output. Apply
swaps both public generation and private evidence, then records the rolled-back revision set. A
second rollback swaps back to the other retained generation. This is local filesystem rollback, not
a remote host/cache operation.

## Release an inactive slug reservation

Withdrawn and moved URLs remain reserved until an operator proves a release is safe. Plan and
inspect blockers before applying:

```bash
npm run wiki-pub -- --config publisher.config.yaml \
  state release-slug pub_example /knowledge/old-name --json
npm run wiki-pub -- --config publisher.config.yaml \
  state release-slug pub_example /knowledge/old-name --apply \
  --expected-hash sha256:REPLACE_WITH_REVIEWED_PLAN_HASH --yes --json
```

Active canonical names/aliases, active link destinations, redirects, absent reservations, foreign
ownership and invalid state evidence block release. Applying only removes the named reservation;
it does not delete revisions or hosted files.

## Garbage-collect immutable revisions

The default plan retains active revisions, each publication's last deployed revision, every
revision referenced by current or `.previous` evidence in **all** local environments, and zero
additional historical revisions. Use `--history` to retain that many extra revisions per
publication:

```bash
npm run wiki-pub -- --config publisher.config.yaml state gc --history 2 --json
npm run wiki-pub -- --config publisher.config.yaml state gc --history 2 \
  --apply --expected-hash sha256:REPLACE_WITH_REVIEWED_PLAN_HASH --yes --json
```

Review every entry in `remove`. Missing/corrupt revision or deployment evidence blocks apply.
Successful GC removes revision files and their private state references permanently; it does not
alter active output, deployment generations or deployment evidence. Back up the complete private
state before applying.

## Current limitations

- Remote provider upload/deployment adapters are not implemented.
- Cache purge, provider health checks/atomic switching and 410 responses are not implemented.
- Only one previous local directory generation is retained per environment.
- Human review of metadata and content remains required; audits and heuristics are not a privacy proof.
