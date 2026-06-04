# @securityjourney/aspen-connector

CI connector for [SecurityJourney](https://securityjourney.com) — integrates Guardian AI and Aspen Adapt into your security scanning pipeline. Supports **GitLab CI** today, with **GitHub Actions** coming soon.

---

## Modes

Aspen infers which mode to run from which environment variables are set — no explicit mode flag needed.

| Mode                            | Guardian AI | Adapt | Required inputs                                           | What it does                                                                  |
| ------------------------------- | ----------- | ----- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A — Full scan**               | ✅          | ✅    | `ASPEN_SCAN_RESULTS_PATH` + `ASPEN_INSTRUCTION_FILE_PATH` | Rewrites your AI instruction file based on scan results; records CWEs         |
| **B — CWE list + instructions** | ✅          | ✅    | `ASPEN_CWES` + `ASPEN_INSTRUCTION_FILE_PATH`              | Rewrites your AI instruction file from an explicit CWE list; scanner-agnostic |
| **C — CWEs only**               | ❌          | ✅    | `ASPEN_CWES`                                              | Records a CWE list directly; no instruction file update                       |
| **D — Extract CWEs**            | ❌          | ✅    | `ASPEN_SCAN_RESULTS_PATH`                                 | Extracts CWEs from scan results and records them; no instruction file update  |

**Modes A and B** update and commit back your AI instruction file — they require git write access (see [Commit-back setup](#gitlab-commit-back-cijobtoken-requirements) below).
**Modes C and D** only record CWEs — no git access needed.

To run Guardian AI without Adapt CWE recording, set `ASPEN_EXCLUDE_GIT_METADATA_FIELDS=all` on any mode. Guardian will still rewrite and commit the instruction file; CWEs will not be recorded.

---

## GitLab CI usage

### Mode A — Rewrite instructions from scan results

```yaml
aspen:
  image: node:20
  script:
    - git remote set-url origin "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
    - npx @securityjourney/aspen-connector
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_SCAN_RESULTS_PATH: results.sarif
    ASPEN_INSTRUCTION_FILE_PATH: .gitlab/ai-instructions.md
    # ASPEN_SCANNER_TYPE is optional — auto-detected from scan results
```

### Mode B — Rewrite instructions from a CWE list

```yaml
aspen:
  image: node:20
  script:
    - git remote set-url origin "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
    - npx @securityjourney/aspen-connector
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_CWES: '["CWE-79","CWE-89"]'
    ASPEN_INSTRUCTION_FILE_PATH: .gitlab/ai-instructions.md
```

### Mode C — Record a CWE list (no instruction update)

```yaml
aspen:
  image: node:20
  script:
    - npx @securityjourney/aspen-connector
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_CWES: '["CWE-79","CWE-89"]'
```

### Mode D — Extract and record CWEs from scan results

```yaml
aspen:
  image: node:20
  script:
    - npx @securityjourney/aspen-connector
  variables:
    ASPEN_API_TOKEN: $SECURITYJOURNEY_TOKEN
    ASPEN_SCAN_RESULTS_PATH: results.sarif
    # ASPEN_SCANNER_TYPE is optional — auto-detected from scan results
```

---

## Environment variables

| Variable                            | Required   | Default                   | Description                                                                                                      |
| ----------------------------------- | ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ASPEN_API_TOKEN`                   | Yes        | —                         | Your SecurityJourney API token                                                                                   |
| `ASPEN_API_DOMAIN`                  | No         | `api.securityjourney.com` | API domain override                                                                                              |
| `ASPEN_SCAN_RESULTS_PATH`           | Modes A, D | —                         | Path to a SARIF or scanner JSON output file                                                                      |
| `ASPEN_INSTRUCTION_FILE_PATH`       | Modes A, B | —                         | Path to an AI instruction file, or a directory containing one `.md` file                                         |
| `ASPEN_CWES`                        | Modes B, C | —                         | JSON array of CWE IDs, e.g. `'["CWE-79","CWE-89"]'`                                                             |
| `ASPEN_SCANNER_TYPE`                | No         | auto-detected             | Override scanner detection: `snyk`, `bandit`, `sonarqube`, `semgrep`, etc.                                       |
| `ASPEN_AUTO_COMMIT`                 | No         | `true`                    | Set `false` to skip writing and committing the updated instruction file (Modes A, B)                             |
| `ASPEN_COMMIT_MESSAGE`              | No         | auto-generated            | Custom commit message for the instruction file update. `[skip ci]` is appended automatically if not present.     |
| `ASPEN_EXCLUDE_GIT_METADATA_FIELDS` | No         | `[]`                      | `all` to disable CWE recording entirely (Guardian-only run), or a JSON array of fields to omit: `"repo"`, `"username"`, `"prNumber"` |

---

## GitLab commit-back: `CI_JOB_TOKEN` requirements

Modes A and B commit the updated instruction file back to the branch. The pipeline must configure the git remote with write access before running aspen:

```yaml
script:
  - git remote set-url origin "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
```

`CI_JOB_TOKEN` requires **"CI/CD job token" write access** enabled in the project's **Settings → CI/CD → Token Access**. If your project does not allow this, use a project access token with `write_repository` scope:

```yaml
script:
  - git remote set-url origin "https://aspen-bot:${PROJECT_ACCESS_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
```

The connector configures git identity automatically (`aspen-bot` by default, or the pipeline user's identity if `GITLAB_USER_EMAIL` / `GITLAB_USER_NAME` are set). No additional `git config` steps are required in your pipeline.

---

## GitHub Actions

GitHub Actions support is coming soon.

---

## Requirements

- Node.js 20+
- GitLab 15.x or later (for `CI_COMMIT_COMMITTER_EMAIL`)
