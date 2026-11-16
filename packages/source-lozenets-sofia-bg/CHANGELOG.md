# Changelog

## 0.2.0

- Adopt shared RSS helper 0.5.0 with at most two paced attempts inside one 30-second timeout budget.
- Retain feed identity, attempt counts and safe nested network causes in failures.
- Add optional per-source retry and recovery reporting through the factory's second argument.
- Preserve literal article identifiers, RSS dates, article extraction and browser pacing.

## 0.1.0

- Extract the Lozenets RSS and article source into an independently versioned package.
- Preserve source identity, RSS dates, page title fallback, content cleanup, and browser pacing through the shared website helper.
