import { decodeHtmlEntities } from "./entities.js";
import { SITE_HOST } from "./discovery.js";

const CONTENT_UNWANTED_TAGS = ["script", "style", "nav", "header"];
const ATTACHMENT_NOTE_TEXT = "Публикацията съдържа само прикачени файлове без текст в страницата.";

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function extractPostDetailsFromHtml(
  html: string,
  url: string,
): { title: string; dateText: string; contentHtml: string } {
  const contentOuterHtml = extractElementOuterHtmlById(html, "div", "body");
  if (!contentOuterHtml) {
    throw new Error(`Failed to extract content from ${url}`);
  }

  const titleRegion =
    extractElementOuterHtmlByClass(html, "div", "content-wrapper") ?? html;
  const title = cleanText(
    extractFirstTagText(titleRegion, "h2") ??
      extractFirstTagText(html, "h2") ??
      "",
  );
  const dateText = cleanText(
    stripTags(
      stripOuterTag(
        extractElementOuterHtmlById(html, "div", "publish-date") ?? "",
        "div",
      ),
    ),
  );
  const contentHtml = removeUnwantedElements(
    stripOuterTag(contentOuterHtml, "div"),
    CONTENT_UNWANTED_TAGS,
  ).trim();

  if (cleanText(stripTags(contentHtml))) {
    return { title, dateText, contentHtml };
  }

  const attachmentFallbackHtml = extractAttachmentFallbackHtml(html);
  if (attachmentFallbackHtml) {
    return { title, dateText, contentHtml: attachmentFallbackHtml };
  }

  throw new Error(`Failed to extract content from ${url}`);
}

function extractElementOuterHtmlById(
  html: string,
  tagName: string,
  id: string,
): string | null {
  const pattern = new RegExp(
    String.raw`<${tagName}\b[^>]*\sid=("|')${escapeRegExp(id)}\1[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  return match ? extractBalancedElement(html, tagName, match) : null;
}

function extractElementOuterHtmlByClass(
  html: string,
  tagName: string,
  className: string,
): string | null {
  const pattern = new RegExp(
    String.raw`<${tagName}\b[^>]*\sclass=("|')[^"']*\b${escapeRegExp(className)}\b[^"']*\1[^>]*>`,
    "i",
  );
  const match = pattern.exec(html);
  return match ? extractBalancedElement(html, tagName, match) : null;
}

function extractBalancedElement(
  html: string,
  tagName: string,
  match: RegExpExecArray,
): string | null {
  const startIndex = match.index;
  const tokenRe = new RegExp(String.raw`<\/?${tagName}\b[^>]*>`, "gi");
  tokenRe.lastIndex = startIndex + match[0].length;

  let depth = 1;
  let tokenMatch: RegExpExecArray | null;

  while ((tokenMatch = tokenRe.exec(html)) !== null) {
    const token = tokenMatch[0];
    const isClosingTag = token.startsWith("</");
    const isSelfClosingTag = token.endsWith("/>");

    if (isClosingTag) {
      depth--;
    } else if (!isSelfClosingTag) {
      depth++;
    }

    if (depth === 0) {
      return html.slice(startIndex, tokenRe.lastIndex);
    }
  }

  return null;
}

function extractFirstTagText(html: string, tagName: string): string | null {
  const match = new RegExp(
    String.raw`<${tagName}\b[^>]*>([\s\S]*?)<\/${tagName}>`,
    "i",
  ).exec(html);
  return match ? stripTags(match[1] ?? "") : null;
}

function stripOuterTag(outerHtml: string, tagName: string): string {
  return outerHtml
    .replace(new RegExp(String.raw`^<${tagName}\b[^>]*>`, "i"), "")
    .replace(new RegExp(String.raw`<\/${tagName}>$`, "i"), "");
}

function removeUnwantedElements(html: string, tagNames: string[]): string {
  let cleaned = html;

  for (const tagName of tagNames) {
    cleaned = cleaned.replace(
      new RegExp(String.raw`<${tagName}\b[^>]*>[\s\S]*?<\/${tagName}>`, "gi"),
      "",
    );
    cleaned = cleaned.replace(new RegExp(String.raw`<${tagName}\b[^>]*/>`, "gi"), "");
  }

  return cleaned;
}

function extractAttachmentFallbackHtml(html: string): string {
  const candidateHtml = [
    extractElementOuterHtmlByClass(html, "div", "card20"),
    extractElementOuterHtmlByClass(html, "div", "image-gallery-wrapper"),
    extractElementOuterHtmlByClass(html, "ul", "galleryList"),
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  if (!candidateHtml) {
    return "";
  }

  const attachmentUrls = extractAttachmentUrls(candidateHtml);
  if (attachmentUrls.length === 0) {
    return "";
  }

  const linksHtml = attachmentUrls
    .map((attachmentUrl, index) => {
      const label = escapeHtml(buildAttachmentLabel(attachmentUrl, index));
      return `<li><a href="${escapeHtml(attachmentUrl)}">${label}</a></li>`;
    })
    .join("");

  return `<p>${ATTACHMENT_NOTE_TEXT}</p><ul>${linksHtml}</ul>`;
}

function extractAttachmentUrls(html: string): string[] {
  const urls = new Set<string>();
  const attributeRe = /<(?:a|img)\b[^>]*\s(?:href|src)=(["'])([^"']+)\1[^>]*>/gi;

  let match: RegExpExecArray | null;
  while ((match = attributeRe.exec(html)) !== null) {
    const normalizedUrl = normalizeUrl(match[2] ?? "");
    if (normalizedUrl) {
      urls.add(normalizedUrl);
    }
  }

  return [...urls];
}

function normalizeUrl(rawUrl: string): string | null {
  const decodedUrl = decodeHtmlEntities(rawUrl.trim());
  if (!decodedUrl || decodedUrl.startsWith("data:")) {
    return null;
  }

  try {
    return new URL(decodedUrl, SITE_HOST).toString();
  } catch {
    return null;
  }
}

function buildAttachmentLabel(url: string, index: number): string {
  const pathname = new URL(url).pathname;
  const rawName = pathname.split("/").pop() ?? "";
  const decodedName = decodeURIComponent(rawName).trim();
  return decodedName || `Прикачен файл ${index + 1}`;
}

function stripTags(html: string): string {
  return decodeHtmlEntities(stripHtmlTags(html, " "));
}

function cleanText(text: string): string {
  return decodeHtmlEntities(text).replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function stripHtmlTags(text: string, replacement: string = ""): string {
  let result = "";
  let insideTag = false;

  function isTagStartAt(index: number): boolean {
    const next = text[index + 1];
    return Boolean(next?.match(/[A-Za-z!/]/));
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "<") {
      if (insideTag || isTagStartAt(i)) {
        insideTag = true;
        continue;
      }

      result += char;
      continue;
    }

    if (char === ">") {
      if (insideTag) {
        insideTag = false;
        result += replacement;
      } else {
        result += char;
      }
      continue;
    }

    if (!insideTag) {
      result += char;
    }
  }

  return result;
}
