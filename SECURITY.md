# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/lienardale/velo-atelier/security/advisories/new)
(Security → Advisories → Report a vulnerability). That creates a private thread
between you and the maintainer where a fix can be prepared before anything is
public.

If GitHub private advisories are unavailable to you, open a public **Bug
report** (blank issues are disabled) whose "What happened?" says only
_"security report, please open a private channel"_ — with no details in any
field.

### What to include

- What you did, and what happened.
- The affected URL, route or file.
- Impact in one sentence: what can an attacker read, change or destroy?
- A proof of concept if you have one.

### What to expect

|                              |                                                              |
| ---------------------------- | ------------------------------------------------------------ |
| First response               | within 7 days                                                |
| Assessment and plan          | within 14 days                                               |
| Fix or documented mitigation | within **90 days** of the report                             |
| Credit                       | your name (or handle) in the advisory, unless you prefer not |

This is a spare-time, single-maintainer project. Those windows are honest
commitments, not an SLA backed by a team.

### Scope

In scope: this repository and the deployed site.

Out of scope, because they are known and accepted for now:

- **Account enumeration on sign-up** — the form says when an email is already
  registered. Documented in the file header of the sign-up action.
- **No password reset by email** — there is no mailer in this project yet; a
  logged-in user can change their password, a Google-only user can set one.
- Missing rate limits on purely public, read-only pages.
- Findings that require a compromised device or a malicious browser extension.
- Reports produced only by a scanner, with no demonstrated impact.

### Safe harbour

Test against your **own** account and your **own** data. Do not run automated
scanners against the production site, do not access, modify or delete anyone
else's data, and do not degrade the service for others. Research done in that
spirit will never be met with a legal complaint from this project.

## How this project tries to stay safe

Every pull request that changes code, and every push to `main`, runs
`gitleaks` (full history), `audit-ci`, `semgrep` (OWASP Top 10 + TS/JS/Next/React),
`trivy fs` and the `tests/security/**` suite — IDOR, mass assignment, CSRF and
origin checks, open redirects, the password policy, rate limiting, OAuth account
linking, guest-import caps, XSS, SQL injection, path traversal and quotas.
CodeQL (`security-and-quality`) runs on every pull request to `main`, every push
to `main`, and weekly. Locally, the pre-commit hook scans the staged changes
with gitleaks when it is installed.

Passwords are hashed with bcrypt (cost 12). A password must be at least 12
characters and at most 72 bytes (bcrypt's own limit), use 3 of the 4 character
classes, not be built from the account's e-mail address, carry no leading or
trailing whitespace, not appear in — or be built on a word of — the bundled
list of the 10 001 most common passwords (SecLists), and score at least 3 on
zxcvbn. The server
applies every rule whatever the browser did.
