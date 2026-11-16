# Changelog

## 0.2.0

- Add an optional listing observer to both module entrypoints. It receives the fetched HTML and observation time before content parsing, using the existing request.
- Permit an empty discovery after the observer verifies zero listed incidents. Reject invalid counts, contradictory zero counts and observer failures while preserving the default empty-list rejection.
- Recheck cancellation after an asynchronous observer completes and retain the existing synthetic identifiers, content and geometry behavior.

## 0.1.0

- Extract Toplo's listing-only incidents into the source SDK contract with unchanged synthetic identifiers, source metadata, Bulgarian content and geometry semantics.
- Fetch embedded provider JSON directly over HTTP and retain listing content in one scan's source instance.
- Add frozen compatibility fixtures and tests for large incidents, malformed blocks, geometry correction, cancellation and isolated metadata.
