# District post fixtures

`district-posts.json` transcribes six public notices supplied by a maintainer on 6 November 2026 from the Oborishte and Studentski Facebook Pages. The messages cover a civic invitation, completed cleaning, a school opening, a collection event, election statistics, and a heating outage.

The copied Markdown links around emoji and tagged Page names are represented by their visible text. Page headers, navigation labels, and Facebook tracking parameters are excluded. Each supplied post permalink keeps its original `pfbid` path. This is a visible-text transcription from a browser copy.

Actual numeric Page/post API IDs, publication and update timestamps, and attachment details were not supplied. `publishedAt: null` and `media: "unknown"` record those gaps. The cleanup and heating examples also lack confirmed post permalinks, so their `postUrl` values remain `null`. Their Page URLs provide provenance.

Tests wrap these texts in modeled Graph responses with clearly synthetic numeric identities and credentials. Positive content tests use an explicitly synthetic publication timestamp. Omission tests keep the unknown timestamps or permalinks missing and check the resulting review errors. Dates mentioned in a message remain content; tests never borrow them as publication metadata.

`reviewNotes` describe cases for later human or pipeline review. They provide no expected AI relevance, category, location, or timespan result. In particular, the heating headline says 7 November while its body gives 8 November at 20:00. The source preserves that conflict. Existing synthetic fixtures cover attachment response shapes.

These fixtures stay in the test directory and are excluded from the published npm tarball.
