# AI Code Assistant Security Instructions (Server + Client JavaScript)

- Review and enforce: disallow dynamic code execution (eval / new Function / setTimeout/code strings); prefer function references or safe interpreters.
- Enforce parameterized queries/ORM APIs and strict input validation to eliminate SQL injection.
- Enforce context-aware output encoding/templating and CSP to prevent XSS.
- Add CI SAST/DAST, linting rules, and unit tests that include malicious input cases.
- Require explicit taint/source declarations and in-code sanitization comments when user input is used.

## Purpose
These instructions guide the AI Code Assistant to generate code for this repository that prevents Code Injection (CWE-94), SQL Injection (CWE-89), and Cross-Site Scripting (CWE-79). They are concise, prescriptive rules and examples the assistant must follow whenever producing JavaScript/Node.js or browser JS code.

## High-level policies for generated code
- Never generate code that executes strings as code (eval, new Function, setTimeout/ setInterval with string argument, Function.prototype.constructor, vm.runInContext with untrusted input, or launching shell commands constructed from user input).
- Always use parameterized queries or ORM binding APIs for database access. Never assemble SQL by string concatenation using user input.
- Validate and canonicalize all user inputs at the trust boundary (server endpoints, query parameters, request bodies, cookies, headers) using allowlists and strong type checks.
- Escape / encode outputs based on their rendering context (HTML text, HTML attribute, JavaScript literal, URL, CSS) rather than generic string replacement.
- Prefer safe templating or frameworks that auto-escape (e.g., React/Vue with default escaping, Handlebars/Mustache) and avoid direct use of innerHTML or dangerouslySetInnerHTML unless input is explicitly sanitized and documented.
- Add automated security checks (linters, SAST) and unit tests simulating malicious input to CI for every PR that touches code handling external input.

## Requirements for input handling (server-side and client-side)
- Always document the expected source and type of any external input variable in the code comment (e.g., // source: req.body.userInput — expects alphanumeric id).
- Apply validation: type check, length check, regex allowlist, numeric ranges, enumerations where applicable.
- If input must allow rich formats (HTML or markdown), require an explicit sanitization step using a well-maintained library (e.g., DOMPurify in browser, sanitize-html on server) and clearly document why the sanitizer is safe for the use case.
- For file paths, use strict canonicalization and prohibit path traversal (normalize and check against an allowlist base directory).
- When using inputs in logs, redact or mask secrets and PII.

## Preventing Code Injection (CWE-94)
- Never generate or permit code that uses:
  - eval(...), Function(...), new Function(...), setTimeout(string, ...)/setInterval(string, ...), vm.runInContext(...) with untrusted data, or constructing shell commands that include user input.
- If dynamic behavior is required, prefer:
  - mapping tables (object lookup) from a validated token to a safe function, or
  - declarative configuration that is validated against a schema, or
  - restricted template engines that do not execute arbitrary code.
- Example rejection pattern (AI must not generate):
```js
// DO NOT GENERATE:
const userCode = req.body.code;
eval(userCode); // forbidden
```
- Example safe alternative:
```js
// SAFE: map validated action name to function
const ACTIONS = {
  listUsers: () => listUsers(),
  sendReport: () => sendReport()
};
const action = String(req.body.action || '');
if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
  throw new Error('Invalid action');
}
ACTIONS[action]();
```

## Preventing SQL Injection (CWE-89)
- Always use parameterized queries or ORM binding. Never concatenate or template untrusted input into SQL statements.
- If using raw queries, always use driver placeholders and bind parameters.
- Prefer query builders/ORMs (Knex, Sequelize, TypeORM) with automatic parameterization.
- Validate input types and ranges before use in queries, and prefer numeric or UUID types validated by schema.

Example safe usages:
- node-postgres (pg)
```js
// SAFE: parameterized query with $1, $2...
const res = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
```
- mysql2 / mysql
```js
// SAFE: ? placeholders
const [rows] = await connection.execute('SELECT * FROM users WHERE email = ?', [email]);
```
- Knex
```js
// SAFE: knex bindings
await knex('users').where({ id: userId }).select();
```

Forbidden pattern:
```js
// DO NOT GENERATE:
db.query("SELECT * FROM users WHERE email = '" + req.body.email + "'");
```

## Preventing Cross-Site Scripting (CWE-79)
- Server-side rendering: escape data per context (HTML text, attribute, JS string, URL).
- Client-side rendering: prefer textContent/textNode updates and template frameworks that auto-escape. Avoid innerHTML/insertAdjacentHTML with direct user input.
- If HTML from users must be displayed, sanitize with a vetted library and explicitly document allowed tags and attributes.
- Implement and recommend a strong Content Security Policy (CSP) and secure cookie flags to reduce impact of possible XSS.

Example safe server-side encoding (Node):
```js
const escapeHtml = require('escape-html'); // or use templating engine auto-escaping
res.send(`<div>${escapeHtml(userSuppliedName)}</div>`);
```

Client-side sanitization example:
```js
// Using DOMPurify in browser
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(userHtml);
element.innerHTML = clean;
```

CSP header example (use helmet for Express):
```js
// Express + helmet
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));
```

## Linting, static analysis, and CI
- Enforce ESLint rules that catch dangerous patterns:
  - no-eval, no-implied-eval, no-new-func, no-buffer-constructor, security plugin (eslint-plugin-security), and node/no-unsupported-features.
- Add the following to the repository ESLint config (snippet):
```json
// .eslintrc.json snippet
{
  "plugins": ["security"],
  "rules": {
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
    "security/detect-eval-with-expression": "error",
    "security/detect-unsafe-regex": "warn"
  }
}
```
- CI pipeline must run:
  - eslint (with security plugin),
  - unit tests (including malicious input cases),
  - SAST tools (e.g., npm audit, snyk, semgrep rules for eval/SQL concatenation/XSS sinks),
  - DAST for web endpoints where feasible.
- PRs must not merge if any high/medium security findings remain unresolved.

## Testing requirements
- Include unit tests for every input-handling function that include:
  - SQL injection payloads (e.g., ' OR 1=1 --),
  - XSS payloads (e.g., <script>alert(1)</script>),
  - Code injection payloads (strings containing JS to be executed).
- Tests should assert that payloads are either rejected, sanitized, or encoded, and that no dangerous functions are invoked.

Example test outline (pseudocode):
```js
it('rejects SQL injection payloads', async () => {
  const res = await request(app).post('/user').send({ id: "1 OR 1=1" });
  expect(res.status).not.toBe(500);
  expect(db.query).toHaveBeenCalledWith(expect.stringContaining('$1') /* or proper params */);
});
```

## Dependency and secret handling
- Prefer maintained libraries with security histories. Keep dependencies up to date and run automated dependency scanners.
- Do not hardcode secrets in code; use environment variables or secret stores. When generating code examples, show usage via process.env and add comments to rotate and manage secrets.
- When logging, redact tokens, passwords, and PII.

## Code generation rules for the AI Code Assistant (explicit)
- Always include a one-line security rationale comment when generating handlers that accept external input (source + how it is validated/encoded).
- If any code uses user input in a sensitive sink (DB, template, shell, eval), the assistant must:
  1) refuse and provide a secure alternative, or
  2) generate the secure alternative and annotate it with validation/sanitization steps.
- Do not produce code that:
  - uses eval/new Function/setTimeout with string arguments,
  - concatenates user input into SQL or shell commands,
  - injects unescaped user input into HTML via innerHTML or similar without sanitization,
  - stores raw user input in logs or error messages without redaction.
- For endpoints, always include schema validation example (e.g., using AJV or Joi) before business logic:
```js
// Example: Joi validation
const schema = Joi.object({
  id: Joi.string().regex(/^[a-f0-9-]{36}$/).required()
});
const { error, value } = schema.validate(req.params);
if (error) return res.status(400).send('Invalid input');
```

## Example safe snippets
- Parameterized SQL (pg)
```js
// SAFE: parameterized query
// source: req.params.id (expected: UUID)
const { id } = req.params;
const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
```
- Escaping for HTML text
```js
// SAFE: escape HTML output
const escapeHtml = require('escape-html');
res.send(`<p>${escapeHtml(userInput)}</p>`);
```
- Safe templating with automatic escaping (e.g., Handlebars)
```js
// Handlebars auto-escapes by default
res.render('profile', { name: userName });
```

## Audit, review, and PR requirements
- Every PR that touches input-handling code must include:
  - Explanation of threat model for new/changed handlers,
  - Tests demonstrating defenses for SQLi/XSS/Code-injection scenarios,
  - Linter & SAST scan results (CI links) or confirmation that CI passed security checks.
- Security reviewers must verify that:
  - All DB access uses parameterization or validated query builder APIs,
  - No dynamic code execution is introduced,
  - Output encoding or sanitization is correct for render context,
  - CSP and secure cookie flags exist for web apps.

## Quick checklist for AI use (to be enforced on generation time)
- [ ] Source of each external input is declared and validated.
- [ ] No eval/new Function/no setTimeout/string usage.
- [ ] All SQL uses parameterized APIs or ORM methods.
- [ ] All HTML/JS/CSS outputs are encoded for their context or sanitized with a documented library.
- [ ] ESLint security rules and tests included or updated for new code.
- [ ] CI runs SAST/DAST and unit tests with malicious payloads.

## Failure handling and explicit refusals
- If the requested code pattern inherently requires executing untrusted strings (for example, end-user plugins that run arbitrary code), refuse and return a secure design alternative (sandboxed VM with strict allowlists and provenance, or a service to run vetted plugins) and document the remaining risks.
- The assistant must explicitly refuse to produce sample code that demonstrates insecure practices (eval, SQL concatenation, direct innerHTML with untrusted input). Instead provide secure replacements.

---

Adhering to these instructions will prevent generation of code that leads to Code Injection (CWE-94), SQL Injection (CWE-89), and XSS (CWE-79) vulnerabilities in future contributions by AI code assistants.