# Security policy

## Reporting a vulnerability

Please open a private security advisory on GitHub instead of a public issue.

## Rules for contributors

- Never commit secrets. `.env` is git-ignored; `.env.example` holds placeholder values only.
- Family data is private by design: proof media (photos / videos of family members, including
  minors) is deleted automatically after 72 hours and must never be exported, shared or used
  for training. See `docs/PROJECT_GUIDE.md` section 4.10 and 10.
- API access is scoped per family. Any query that can cross family boundaries is a security bug.
- Media is served through signed, short-lived URLs.