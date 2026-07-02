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

### Mode E — Enforce training-assignment compliance

Checks the committer's training-assignment status through your Aspen training endpoint and fails CI when the user is non-compliant. Use this mode by itself for merge gates, or combine it with Modes A-D to run the gate before Aspen processing.

---

To run Guardian AI without Adapt CWE recording, set `ASPEN_EXCLUDE_GIT_METADATA_FIELDS=all` on Modes A or B. Guardian will still rewrite and commit the instruction file; CWEs will not be recorded.

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

````yaml
aspen:
  image: node:22
  script:
    - npx @securityjourney/aspen-connector@0.1.2
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_SCAN_RESULTS_PATH: results.sarif

### Mode E — Training gate only

```yaml
aspen_training_gate:
  image: node:22
  script:
    - npx @securityjourney/aspen-connector@0.1.2
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_ENFORCE_TRAINING: 'true'
    # Optional overrides:
    # ASPEN_TRAINING_STATUS_PATH: /integrations/training/assignment-status
    # ASPEN_TRAINING_REQUIRED_ASSIGNMENTS: '["secure-coding-101","owasp-top-10"]'
    # ASPEN_TRAINING_BLOCKING_STATUSES: '["incomplete","overdue","failed"]'
    # ASPEN_TRAINING_FAIL_OPEN: 'false'
````

````

---

## Environment variables

| Variable                            | Required   | Default                   | Description                                                                                                      |
| ----------------------------------- | ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ASPEN_API_TOKEN`                   | Yes        | —                         | Your SecurityJourney API token                                                                                   |
| `ASPEN_API_DOMAIN`                  | No         | `api.securityjourney.com` | API domain override                                                                                              |
| `ASPEN_SCAN_RESULTS_PATH`           | Modes A, D | —                         | Path to a SARIF or scanner JSON output file                                                                      |
| `ASPEN_INSTRUCTION_FILE_PATH`       | Modes A, B | —                         | Path to an AI instruction file, or a directory containing one `.md` file                                         |
| `ASPEN_CWES`                        | Modes B, C | —                         | JSON array of CWE IDs, e.g. `'["CWE-79","CWE-89"]'`                                                              |
| `ASPEN_SCANNER_TYPE`                | No         | auto-detected             | Override scanner detection: `snyk`, `bandit`, `sonarqube`, `semgrep`, etc.                                       |
| `ASPEN_AUTO_COMMIT`                 | No         | `true`                    | Set `false` to skip writing and committing the updated instruction file (Modes A, B)                             |
| `ASPEN_COMMIT_MESSAGE`              | No         | auto-generated            | Custom commit message for the instruction file update. `[skip ci]` is appended automatically if not present.     |
| `ASPEN_EXCLUDE_GIT_METADATA_FIELDS` | No         | `[]`                      | `all` to disable CWE recording entirely, or a JSON array of fields to omit: `"repo"`, `"username"`, `"prNumber"` |
| `ASPEN_ENFORCE_TRAINING`            | No         | `false`                   | Enables training-assignment enforcement. Can run standalone (Mode E) or as a pre-check before Modes A-D.          |
| `ASPEN_TRAINING_STATUS_PATH`        | No         | `/integrations/training/assignment-status` | API path used for training status checks.                                                                      |
| `ASPEN_TRAINING_REQUIRED_ASSIGNMENTS` | No       | `[]`                      | Optional JSON array of required assignment IDs/slugs.                                                             |
| `ASPEN_TRAINING_BLOCKING_STATUSES`  | No         | `'["incomplete","overdue","non_compliant","failed"]'` | JSON array of response `status` values that should fail the gate.                            |
| `ASPEN_TRAINING_FAIL_OPEN`          | No         | `false`                   | If `true`, allows pipeline continuation when the training endpoint is unavailable or returns malformed data.       |

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
````

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

````yaml
steps:
  - uses: actions/checkout@v4

  - name: Run scanner
    run: snyk code test --sarif > results.sarif || true

  - uses: SecurityJourney/aspen-connector@v0.1.2
    with:
      api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
      scan_results_path: results.sarif

### Mode E — Training gate only

```yaml
steps:
  - uses: actions/checkout@v4

  - uses: SecurityJourney/aspen-connector@v0.1.2
    with:
      api_token: ${{ secrets.SECURITYJOURNEY_TOKEN }}
      enforce_training: 'true'
      # Optional overrides:
      # training_status_path: /integrations/training/assignment-status
      # training_required_assignments: '["secure-coding-101","owasp-top-10"]'
      # training_blocking_statuses: '["incomplete","overdue","failed"]'
      # training_fail_open: 'false'
````

To block merges, mark this job as a required status check (GitHub) or require successful MR pipelines (GitLab).

````

---

## Commit-back setup

### GitLab — `CI_JOB_TOKEN`

Modes A and B commit the updated instruction file back to the branch. The pipeline must configure the git remote before running aspen:

```yaml
script:
  - git remote set-url origin "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
````

`CI_JOB_TOKEN` requires **CI/CD job token write access** enabled in the project's **Settings → CI/CD → Token Access**. If your project does not allow this, use a project access token with `write_repository` scope:

```yaml
script:
  - git remote set-url origin "https://aspen-bot:${PROJECT_ACCESS_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
```

The connector configures git identity automatically (`aspen-bot` by default, or the pipeline user's identity if `GITLAB_USER_EMAIL` / `GITLAB_USER_NAME` are set).

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
- GitLab 15.x or later (for `CI_COMMIT_COMMITTER_EMAIL`)
