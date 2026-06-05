# AI Code Assistant Security Instructions — Preventing SQL Injection (CWE-89)

- Revision plan (high level)
  - Explicitly forbid generating SQL via string concatenation with untrusted input; require parameterized queries or ORM query builders.
  - Add language-specific secure code examples and templates (Python, Node.js, Java, C#, PHP).
  - Require CI/static analysis rules (e.g., Semgrep) and tests to detect/prevent SQLi during PRs.
  - Add PR checklist and assistant behavior rules to ensure generated code follows these policies.
  - Provide remediation guidance and fail-safe defaults (least privilege, no secrets, input validation).

## Scope and purpose
These instructions govern how the AI Code Assistant must generate, modify, and review code that interacts with databases. They specifically mitigate CWE-89 (SQL Injection) by enforcing secure coding patterns, CI scanning, and editorial controls so future AI-generated code will not introduce SQL injection vulnerabilities.

## Core policy (applies to all languages and frameworks)
- Treat any SQL statement that includes user input as potentially vulnerable to SQL injection (CWE-89).
- Never generate code that builds SQL by concatenating, interpolating, or templating raw user input into a query string.
- Always use parameterized queries / prepared statements or high-level ORM/query-builder APIs that properly bind parameters.
- If parameterization is not possible, explicitly document why and apply strict whitelist validation + escaping as a last resort (rare).
- Do not include database credentials, secrets, or any sensitive material in generated code or examples.
- Default generated DB accounts to least privilege (only required SELECT/INSERT/UPDATE/DELETE) and recommend role separation.
- Always include unit/integration tests that assert correct behavior for both valid and malicious inputs.

## Required secure patterns (examples you must follow)

- Python (psycopg2):
```python
# Correct: parameterized query (psycopg2)
sql = "SELECT id, name FROM users WHERE email = %s"
cursor.execute(sql, (email_input,))
```

- Python (SQLAlchemy Core):
```python
from sqlalchemy import text

stmt = text("SELECT id, name FROM users WHERE email = :email")
result = connection.execute(stmt, {"email": email_input})
```

- Node.js (pg):
```javascript
// Correct: parameterized query
const text = 'SELECT id, name FROM users WHERE email = $1';
const values = [emailInput];
const res = await client.query(text, values);
```

- Node.js (knex):
```javascript
// Correct: query builder avoids manual SQL concatenation
const rows = await knex('users').select('id', 'name').where('email', emailInput);
```

- Java (JDBC):
```java
String sql = "SELECT id, name FROM users WHERE email = ?";
PreparedStatement ps = conn.prepareStatement(sql);
ps.setString(1, emailInput);
ResultSet rs = ps.executeQuery();
```

- C# (ADO.NET):
```csharp
using var cmd = new SqlCommand("SELECT id, name FROM users WHERE email = @email", conn);
cmd.Parameters.AddWithValue("@email", emailInput);
using var reader = cmd.ExecuteReader();
```

- PHP (PDO):
```php
$stmt = $pdo->prepare('SELECT id, name FROM users WHERE email = :email');
$stmt->execute([':email' => $emailInput]);
```

Notes:
- In all examples, parameter placeholders and binding must be used. The assistant must not substitute user input directly into SQL strings.
- For ORMs, prefer query-builder abstractions that bind parameters for you.

## Validation, encoding, and safe fallbacks
- Validate inputs by type, format, length, and whitelist acceptable characters where possible (e.g., numeric IDs, specific enum values).
- For identifiers (table/column names) that cannot be parameterized, validate against a server-side whitelist and never accept arbitrary identifiers from the client.
- Escaping is a last resort. If used, document the reason and use framework-provided escaping functions; still prefer parameterization.
- Log inputs and errors safely: do not log raw sensitive values or secrets.

## CI / Static Analysis / Tests (required)
- Every repository must include automated checks to detect potential SQL injection patterns in PRs. At minimum:
  - Semgrep rule(s) to detect concatenation/interpolation patterns forming SQL strings.
  - SAST tool integration (e.g., Semgrep, Bandit for Python, ESLint plugins for JS, SpotBugs/FindSecBugs for Java).
  - Unit and integration tests covering malicious inputs (e.g., inputs containing SQL metacharacters) and asserting no unexpected DB operations succeed.
- Example Semgrep rule (YAML) to flag string concatenation with SQL keywords:
```yaml
rules:
  - id: python-sql-concat
    patterns:
      - pattern: $A + $B
      - pattern-either:
          - pattern: $A + $B + $C
    languages: [python, javascript]
    message: "Potential SQL concatenation; use parameterized queries/prepared statements instead"
    severity: ERROR
```
- Example GitHub Actions step (run semgrep):
```yaml
- name: Run semgrep
  uses: returntocorp/semgrep-action@v1
  with:
    config: .semgrep.yml
```

## Pull request requirements
Include a PR template or checklist that must be completed before merge:
- [ ] No SQL built via string concatenation or interpolation with user input.
- [ ] Parameterized queries or ORM query builder used; examples/tests included.
- [ ] SAST scan results attached and any findings addressed.
- [ ] Unit/integration tests for malicious inputs added and passing.
- [ ] Database credentials are not in the code or PR.
- [ ] Minimum required DB privileges documented.

## AI Assistant behavioral rules (must be enforced by the assistant)
- If asked to produce or modify code that interacts with databases, first ask about expected input sources, trust boundaries, and where data originated.
- Always produce the secure, parameterized version as the primary suggestion. If the user requests a concatenated version, refuse and explain risks and present secure alternatives.
- Annotate generated examples with short comments that highlight why parameterization is used.
- When detecting legacy or existing concatenated SQL code in a repository, automatically propose a secure refactor (with tests) and include a migration plan.
- Do not output secrets (credentials, keys) in any code or examples. If user supplies credentials, instruct to move them to secure secret stores (e.g., env vars, vault).
- When language/framework limitations exist, explicitly document the reason and provide the safest possible implementation and compensating controls.

## Remediation guidance (for discovered CWE-89 instances)
- Replace concatenated SQL with parameterized queries or ORM calls; add unit tests asserting malicious payloads are neutralized.
- Add/enable SAST rules and re-run CI; require passing checks before merge.
- Rotate any credentials or keys that may have been exposed.
- Limit DB account privileges and add monitoring/alerts for suspicious queries.

## References
- OWASP: SQL Injection Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
- CWE-89: SQL Injection — https://cwe.mitre.org/data/definitions/89.html
- Semgrep documentation — https://semgrep.dev/docs/