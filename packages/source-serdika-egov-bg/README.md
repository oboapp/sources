# @oboapp/source-serdika-egov-bg

Reads messages, news and events from Sofia district Serdika through the public WebSphere Portal ATOM search endpoint. The catalog source ID is `serdika-egov-bg`, with locality `bg.sofia`.

Install with `pnpm add --save-exact @oboapp/source-serdika-egov-bg`. Pass the named `createSource` export and browser-safe `metadata` from `@oboapp/source-serdika-egov-bg/metadata` to Obo's scheduled runner.

Each discovery page reads one section, in the order messages, news, events. Pass each returned `nextCursor` to the next `discoverItems` call. The portal returns the newest 20 records per section. The source keeps absolute links as supplied, resolves portal-relative links using the site's context path and constructs the historical encoded WCM URL when the feed omits a link.

Article HTML supplies the title, Markdown body and publication date. Notices containing only attachments keep the file links. For events, the labeled publication date takes priority over the event date. The first numeric date or the scan time supplies the existing fallback.

The runtime uses Node.js 20.3 or later and native HTTP. Each request has up to three attempts, with one- and two-second delays for transient failures. Feed and detail timeouts are 30 and 45 seconds. Each attempted detail is followed by a two-second pause. A section failure is reported to the optional `onSectionFailure(section, error)` observer. Other sections still run. When all three fail, discovery rejects. Detail failures affect one item and Obo retries missing items during subsequent scans.

Run `pnpm check` from the repository root. [Contract tests](https://github.com/oboapp/sources/tree/main/packages/source-serdika-egov-bg/test) · [Release guide](https://github.com/oboapp/sources/blob/main/RELEASING.md)
