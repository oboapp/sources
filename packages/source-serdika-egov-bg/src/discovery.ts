import { decodeHtmlEntities } from "./entities.js";

export const SITE_HOST = "https://serdika.egov.bg";
const SEARCH_FEED_BASE = SITE_HOST + "/wps/contenthandler/searchfeed/search";
const SEARCH_SCOPE_ID = "1672924193550";
const DEFAULT_PORTAL_CONTEXT_PATH = "/wps/portal/serdika.egov.bg-15783";
const WCM_CONTENT_PREFIX = "/content/site/";

export function feedUrl(sectionKeyword: string): string {
  const params = new URLSearchParams({
    queryLang: "en",
    locale: "bg",
    resultLang: "bg",
    start: "0",
    results: "20",
    scope: SEARCH_SCOPE_ID,
    query: "*",
    sortKey: "effectivedate",
    sortOrder: "desc",
  });
  // Two separate constraint params (URLSearchParams.append keeps both)
  params.append(
    "constraint",
    JSON.stringify({
      type: "field",
      id: "authoringtemplate",
      values: ["contentFromList"],
    }),
  );
  params.append(
    "constraint",
    JSON.stringify({ type: "field", id: "keywords", values: [sectionKeyword] }),
  );

  return `${SEARCH_FEED_BASE}?${params.toString()}`;
}

export function parseIdentifiers(xml: string): string[] {
  const urls = [];
  for (const match of xml.matchAll(/<atom:entry>([\s\S]*?)<\/atom:entry>/g)) {
    const entryXml = match[1] ?? "";
    const linkHref = decodeHtmlEntities(
      /<atom:link[^>]*href="([^"]+)"[^>]*type="text\/html"[^>]*\/?/i
        .exec(entryXml)
        ?.[1]
        ?.trim() ?? "",
    );
    const portalContextPath = decodeHtmlEntities(
      /<wplc:field id="portalcontextpath">([\s\S]*?)<\/wplc:field>/
        .exec(entryXml)
        ?.[1]
        ?.trim() ?? DEFAULT_PORTAL_CONTEXT_PATH,
    );

    // contentpath field: "/content/site/actual/messages/<slug>"
    const contentPath =
      /<wplc:field id="contentpath">([\s\S]*?)<\/wplc:field>/
        .exec(entryXml)
        ?.[1]
        ?.trim() ?? "";
    if (!contentPath.startsWith(WCM_CONTENT_PREFIX)) {
      continue;
    }

    const url = buildCanonicalDetailUrl(
      contentPath,
      linkHref,
      portalContextPath,
    );

    urls.push(url);
  }
  return urls;
}

function buildCanonicalDetailUrl(
  contentPath: string,
  linkHref: string,
  portalContextPath: string,
): string {
  const normalizedPortalContextPath =
    portalContextPath || DEFAULT_PORTAL_CONTEXT_PATH;

  if (linkHref.startsWith("http://") || linkHref.startsWith("https://")) {
    return linkHref;
  }

  if (linkHref.startsWith("?")) {
    return `${SITE_HOST}${normalizedPortalContextPath}${linkHref}`;
  }

  if (linkHref.startsWith("/")) {
    return `${SITE_HOST}${linkHref}`;
  }

  const uriPath = `wcm:path:${contentPath}`;
  return `${SITE_HOST}${normalizedPortalContextPath}?urile=${encodeURIComponent(uriPath)}`;
}
