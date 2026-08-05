# @securityjourney/aspen-connector

CI connector for [SecurityJourney](https://securityjourney.com) — integrates Guardian AI and Aspen Adapt into your security scanning pipeline. Supports **GitLab CI** and **GitHub Actions**.

This repository serves as both the source for the [`@securityjourney/aspen-connector`](https://www.npmjs.com/package/@securityjourney/aspen-connector) npm package and the [`SecurityJourney/aspen-connector`](https://github.com/SecurityJourney/aspen-connector) GitHub Action. GitLab users install via npm; GitHub users can use the action directly with `uses: SecurityJourney/aspen-connector@v0.1.2`.

---

## Modes

Aspen infers which mode to run from which environment variables are set — no explicit mode flag needed.

### Mode A — Rewrite instructions from scan results

Runs your security scanner, sends the results to Guardian AI, and commits the updated instruction file back to the branch. Also records CWEs against the commit via Adapt.

Requires git write access. See [Commit-back setup](#commit-back-setup).

### Mode B — Rewrite instructions from a CWE list

Same as Mode A but takes an explicit CWE list instead of a raw scan results file. Use this when your pipeline parses CWEs from scanner output directly and passes them as a JSON array.

Requires git write access. See [Commit-back setup](#commit-back-setup).

### Mode C — Record CWEs

Records an explicit CWE list against the commit via Adapt. No instruction file update, no commit-back, no git access needed.

### Mode D — Extract and record CWEs from scan results

Extracts CWEs from scanner output and records them against the commit via Adapt. No instruction file update, no commit-back, no git access needed.

### Mode E — Enforce a compliance gate

Checks the committer's learner-compliance status via SecurityJourney's Aspen gate endpoint and fails CI when they haven't completed the tenant's required training. Use this mode by itself for merge gates, or combine it with Modes A-D to run the gate before Aspen processing — the gate always runs first, and if it passes but no mode inputs (`ASPEN_SCAN_RESULTS_PATH`, `ASPEN_INSTRUCTION_FILE_PATH`, `ASPEN_CWES`) are set, the connector exits successfully after the gate check with no further action. When the gate blocks and the pipeline is running on a pull/merge request, the failure reason is also posted as a PR/MR comment (see `ASPEN_GATE_COMMENT_ON_FAILURE`).

---

To run Guardian AI without Adapt CWE recording, set `ASPEN_EXCLUDE_GIT_METADATA_FIELDS=all` on Modes A or B. Guardian will still rewrite and commit the instruction file; CWEs will not be recorded.

---

## Permissions by mode

Two separate capabilities are gated by two separate credentials — needing one doesn't imply needing the other:

| Capability | Needed by | GitLab | GitHub Actions |
| --- | --- | --- | --- |
| **Commit-back** — push the updated instruction file | Modes A, B | `CI_JOB_TOKEN` with job token write access enabled, or a token with `write_repository` scope. See [Commit-back setup](#commit-back-setup). | `permissions: contents: write` on the job. `GITHUB_TOKEN` handles the rest automatically. |
| **Posting a PR/MR comment** — gate failures (`ASPEN_GATE_COMMENT_ON_FAILURE`, default `true`) | Mode E, or any mode combined with the gate check | `GITLAB_TOKEN`, a token with `api` scope (or `CI_JOB_TOKEN`, if job token API access is enabled for the project). See [Commenting on PRs/MRs](#commenting-on-prsmrs). | `permissions: pull-requests: write` on the job. `GITHUB_TOKEN` handles the rest automatically. |
| Modes C, D alone (no gate) | — | none | none |

Neither Mode C nor D needs any git or API write access — they only call the Adapt API to record CWEs.

**Running Guardian (A/B) and the gate together?** On GitLab, `api` scope is a superset of `write_repository` — one project access token scoped to `api` satisfies both rows above, so you only need to provision a single token, not two. Reuse it for both `GIT_PUSH_TOKEN` (or whatever variable your pipeline uses for the git remote) and `GITLAB_TOKEN`. On GitHub, `GITHUB_TOKEN` is provided automatically either way — just set both `permissions` entries on the job.

---

## GitLab CI

### Mode A — Rewrite instructions from scan results

```yaml
aspen:
  image: node:22
  script:
    - git remote set-url origin "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
    - npx @securityjourney/aspen-connector@0.1.2
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_SCAN_RESULTS_PATH: results.sarif
    ASPEN_INSTRUCTION_FILE_PATH: .gitlab/ai-instructions.md
    # ASPEN_SCANNER_TYPE is optional — auto-detected from scan results
```

### Mode B — Rewrite instructions from a CWE list

```yaml
aspen:
  image: node:22
  script:
    - git remote set-url origin "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
    - npx @securityjourney/aspen-connector@0.1.2
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_CWES: '["CWE-79","CWE-89"]'
    ASPEN_INSTRUCTION_FILE_PATH: .gitlab/ai-instructions.md
```

### Mode C — Record a CWE list (no instruction update)

```yaml
aspen:
  image: node:22
  script:
    - npx @securityjourney/aspen-connector@0.1.2
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_CWES: '["CWE-79","CWE-89"]'
```

### Mode D — Extract and record CWEs from scan results

```yaml
aspen:
  image: node:22
  script:
    - npx @securityjourney/aspen-connector@0.1.2
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_SCAN_RESULTS_PATH: results.sarif
```

### Mode E — Gate check only

```yaml
aspen_gate:
  image: node:22
  script:
    - npx @securityjourney/aspen-connector@0.1.2
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_ENFORCE_GATE: 'true'
    # Optional overrides:
    # ASPEN_GATE_FAIL_OPEN: 'true'
    # ASPEN_GATE_COMMENT_ON_FAILURE: 'true'
```

To comment on merge requests, set `GITLAB_TOKEN` (a project access token with `api` scope) or ensure the project allows CI/CD job token API access. See [Commenting on PRs/MRs](#commenting-on-prsmrs).

---

## Environment variables

| Variable                            | Required   | Default                                   | Description                                                                                                                                                                                            |
| ----------------------------------- | ---------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ASPEN_API_TOKEN`                   | Yes        | —                                         | Your SecurityJourney API token                                                                                                                                                                         |
| `ASPEN_API_DOMAIN`                  | No         | `api.securityjourney.com`                 | API domain override                                                                                                                                                                                    |
| `ASPEN_SCAN_RESULTS_PATH`           | Modes A, D | —                                         | Path to a SARIF or scanner JSON output file                                                                                                                                                            |
| `ASPEN_INSTRUCTION_FILE_PATH`       | Modes A, B | —                                         | Path to an AI instruction file, or a directory containing one `.md` file                                                                                                                               |
| `ASPEN_CWES`                        | Modes B, C | —                                         | JSON array of CWE IDs, e.g. `'["CWE-79","CWE-89"]'`                                                                                                                                                    |
| `ASPEN_SCANNER_TYPE`                | No         | auto-detected                             | Override scanner detection: `snyk`, `bandit`, `sonarqube`, `semgrep`, etc.                                                                                                                             |
| `ASPEN_AUTO_COMMIT`                 | No         | `true`                                    | Set `false` to skip writing and committing the updated instruction file (Modes A, B)                                                                                                                   |
| `ASPEN_COMMIT_MESSAGE`              | No         | auto-generated                            | Custom commit message for the instruction file update. `[skip ci]` is appended automatically if not present.                                                                                           |
| `ASPEN_EXCLUDE_GIT_METADATA_FIELDS` | No         | `[]`                                      | `all` to disable CWE recording entirely, or a JSON array of fields to omit: `"repo"`, `"username"`, `"prNumber"`                                                                                       |
| `ASPEN_ENFORCE_GATE`                | No         | `false`                                   | Enables the learner-compliance gate check. Can run standalone (Mode E) or as a pre-check before Modes A-D. `POST`s `{"emails": [committerEmail]}` to `/integrations/learner-compliance/status` and reads the result matching the committer's email (falling back to `results[0]` if no match is found). |
| `ASPEN_GATE_FAIL_OPEN`              | No         | `true`                                    | If `false`, blocks CI when the gate endpoint reports an internal error, times out, or returns something unreadable — this only covers our own infrastructure failing, not a real non-compliant result. |
| `ASPEN_GATE_COMMENT_ON_FAILURE`     | No         | `true`                                    | If `true`, posts the gate failure reason as a comment on the PR/MR (requires PR/MR context and write access — see [Commenting on PRs/MRs](#commenting-on-prsmrs)).                                     |

---

## GitHub Actions

The action handles Node.js setup internally. `actions/checkout` must run before the action — typically already present in your workflow for the scanner step.

### Mode A — Rewrite instructions from scan results

```yaml
jobs:
  aspen:
    permissions:
      contents: write # required for commit-back
    steps:
      - uses: actions/checkout@v4

      - name: Run scanner
        run: snyk code test --sarif > results.sarif || true

      - uses: SecurityJourney/aspen-connector@v0.1.2
        with:
          api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
          scan_results_path: results.sarif
          instruction_file_path: .github/ai-instructions.md
          # scanner_type is optional — auto-detected from scan results
```

### Mode B — Rewrite instructions from a CWE list

```yaml
jobs:
  aspen:
    permissions:
      contents: write # required for commit-back
    steps:
      - uses: actions/checkout@v4

      - uses: SecurityJourney/aspen-connector@v0.1.2
        with:
          api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
          cwes: '["CWE-79","CWE-89"]'
          instruction_file_path: .github/ai-instructions.md
```

### Mode C — Record a CWE list (no instruction update)

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: SecurityJourney/aspen-connector@v0.1.2
    with:
      api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
      cwes: '["CWE-79","CWE-89"]'
```

### Mode D — Extract and record CWEs from scan results

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Run scanner
    run: snyk code test --sarif > results.sarif || true

  - uses: SecurityJourney/aspen-connector@v0.1.2
    with:
      api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
      scan_results_path: results.sarif
```

### Mode E — Gate check only

```yaml
permissions:
  pull-requests: write # needed for gate_comment_on_failure

steps:
  - uses: actions/checkout@v4

  - uses: SecurityJourney/aspen-connector@v0.1.2
    with:
      api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
      enforce_gate: 'true'
      # Optional overrides:
      # gate_fail_open: 'true'
      # gate_comment_on_failure: 'true'
```

To block merges, mark this job as a required status check (GitHub) or require successful MR pipelines (GitLab).

---

## Commenting on PRs/MRs

When `ASPEN_GATE_COMMENT_ON_FAILURE` is `true` (the default) and the gate blocks on a pull/merge request, the connector posts the failure reason returned by the Aspen gate endpoint as a comment. Comment failures are logged as warnings and never override the gate result.

- **GitHub Actions**: uses the built-in `GITHUB_TOKEN`. Grant `permissions: pull-requests: write` in the workflow (see Mode E example above).
- **GitLab CI**: uses `GITLAB_TOKEN` (a project/personal access token with `api` scope) if set, otherwise falls back to `CI_JOB_TOKEN`. The job token path requires **CI/CD job token API access** to be allowed for the project (**Settings → CI/CD → Token Access**); if your project disallows it, set `GITLAB_TOKEN` instead.
- On `push` events (no PR/MR number available), commenting is skipped — only the gate check itself runs.

**Comment author name (GitLab):** the MR comment is posted as whichever account owns the `GITLAB_TOKEN` — there's no field to override this, unlike `commitFile()`'s `GITLAB_USER_NAME`/`GITLAB_USER_EMAIL`. If `GITLAB_TOKEN` is a **Project Access Token**, GitLab auto-creates a bot user whose display name defaults to whatever "Name" you gave the token at creation — so naming the token e.g. `GIT_TOKEN` (matching the CI/CD variable name) makes comments show up as authored by "GIT_TOKEN". These are two independent things that happen to collide: the CI/CD variable name (referenced in your pipeline as `$GIT_TOKEN`) and the token's own "Name" field (the bot's display name). Project access tokens can't be renamed after creation — to get a friendlier author name, revoke and recreate the token with a name like `aspen-bot`, then update the CI/CD variable's *value* (the variable name itself doesn't need to change).

---

## Commit-back setup

### GitLab — `CI_JOB_TOKEN`

Modes A and B commit the updated instruction file back to the branch. The pipeline must configure the git remote before running aspen:

```yaml
script:
  - git remote set-url origin "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
```

`CI_JOB_TOKEN` requires **CI/CD job token write access** enabled in the project's **Settings → CI/CD → Token Access**. If your project does not allow this, use a project access token with `write_repository` scope:

```yaml
script:
  - git remote set-url origin "https://aspen-bot:${PROJECT_ACCESS_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
```

The connector configures git identity automatically (`aspen-bot` by default, or the pipeline user's identity if `GITLAB_USER_EMAIL` / `GITLAB_USER_NAME` are set).

**One token can cover both commit-back and MR comments.** GitLab's `api` scope is a superset of `write_repository` — a single project access token scoped to `api` authenticates both the git remote above and `GITLAB_TOKEN` (see [Commenting on PRs/MRs](#commenting-on-prsmrs)), so you don't need to provision two separate tokens.

### GitHub Actions — `GITHUB_TOKEN`

The action uses `GITHUB_TOKEN` automatically — no configuration needed. Set `contents: write` on the job and the action handles the rest.

To override the git identity used for the commit, pass environment variables on the step:

```yaml
- uses: SecurityJourney/aspen-connector@v0.1.2
  with:
    api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
    ...
  env:
    ASPEN_GIT_USER_EMAIL: my-bot@example.com
    ASPEN_GIT_USER_NAME: My Bot
```

---

## Requirements

- Node.js 22.3.0 or later
- GitLab: enough clone depth for the commit that triggered the pipeline to be
  reachable locally (`GIT_DEPTH: 0` is the safe default — see the CI examples
  above). The connector reads the committer's email from `git log` on that
  commit rather than from GitLab's predefined CI/CD variables, which aren't
  reliable on merge-request pipelines.
