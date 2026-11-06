import { serializeDiscoveryPayload, type DiscoveredItem, type JsonValue, type SourceContent } from "@oboapp/source-sdk";

export interface FacebookAttachment {
  type?: string;
  id?: string;
  url?: string;
  width?: number;
  height?: number;
}

export interface FacebookPost {
  id: string;
  pageId: string;
  message?: string;
  publishedAt?: string;
  updatedAt?: string;
  permalink?: string;
  attachments: readonly FacebookAttachment[];
  reviewReasons: readonly string[];
}

const messages = {
  invalid_post_id: "Facebook post does not belong to the configured Page",
  invalid_payload: "Invalid Facebook discovery payload",
  missing_text: "Facebook post requires original text before ingestion",
  missing_publication_time: "Facebook post requires a valid publication time before ingestion",
  missing_permalink: "Facebook post requires a public permalink before ingestion",
};

export class FacebookContentError extends Error {
  readonly code: string;
  readonly post?: FacebookPost;

  constructor(code: keyof typeof messages, post?: FacebookPost) {
    super(messages[code]);
    this.name = "FacebookContentError";
    this.code = code;
    if (post) {
      this.post = {
        id: post.id,
        pageId: post.pageId,
        ...(post.publishedAt === undefined ? {} : { publishedAt: post.publishedAt }),
        ...(post.updatedAt === undefined ? {} : { updatedAt: post.updatedAt }),
        ...(post.permalink === undefined ? {} : { permalink: post.permalink }),
        attachments: post.attachments,
        reviewReasons: post.reviewReasons,
      };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

const credentialKeys = new Set([
  "access_token", "appsecret_proof", "app_secret", "client_secret", "authorization",
  "oauth_token", "refresh_token", "id_token", "token", "api_key", "apikey",
]);

function publicUrl(value: unknown, facebookOnly = false): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password ||
        host === "fbcdn.net" || host.endsWith(".fbcdn.net") ||
        host === "fbsbx.com" || host.endsWith(".fbsbx.com") ||
        (facebookOnly && host !== "facebook.com" && !host.endsWith(".facebook.com"))) {
      return undefined;
    }
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (credentialKeys.has(key.toLowerCase())) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    const fragment = new URLSearchParams(url.hash.slice(1));
    for (const key of [...fragment.keys()]) {
      if (credentialKeys.has(key.toLowerCase())) {
        fragment.delete(key);
        url.hash = fragment.toString();
        changed = true;
      }
    }
    return changed ? url.toString() : value;
  } catch {
    return undefined;
  }
}

function timestamp(value: unknown): string | undefined {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) {
    return undefined;
  }
  const milliseconds = Date.parse(value);
  const calendarDate = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(milliseconds) || !Number.isFinite(calendarDate.getTime()) ||
      calendarDate.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    return undefined;
  }
  return new Date(milliseconds).toISOString();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function collectAttachments(
  value: unknown,
  output: FacebookAttachment[],
  review: Set<string>,
  depth = 0,
): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value) || !isList(value.data) || depth > 2) {
    review.add("incomplete_attachment");
    return;
  }
  if (value.data.length > 100 || (isRecord(value.paging) && value.paging.next)) {
    review.add("incomplete_attachment");
  }
  for (const candidate of value.data.slice(0, 100)) {
    if (output.length >= 100) {
      review.add("incomplete_attachment");
      return;
    }
    if (!isRecord(candidate)) {
      review.add("incomplete_attachment");
      continue;
    }
    const target = isRecord(candidate.target) ? candidate.target : {};
    const media = isRecord(candidate.media) ? candidate.media : {};
    const image = isRecord(media.image) ? media.image : {};
    const type = optionalString(candidate.type);
    const id = optionalString(candidate.id) ?? optionalString(target.id);
    const url = publicUrl(candidate.url) ?? publicUrl(target.url);
    const width = typeof image.width === "number" && Number.isFinite(image.width) && image.width >= 0 ? image.width : undefined;
    const height = typeof image.height === "number" && Number.isFinite(image.height) && image.height >= 0 ? image.height : undefined;
    if (!type || (!id && !url) ||
        (candidate.id !== undefined && typeof candidate.id !== "string") ||
        (candidate.target !== undefined && !isRecord(candidate.target)) ||
        (candidate.media !== undefined && !isRecord(candidate.media)) ||
        (media.image !== undefined && !isRecord(media.image)) ||
        (image.width !== undefined && width === undefined) ||
        (image.height !== undefined && height === undefined)) {
      review.add("incomplete_attachment");
    }
    if (type && !new Set(["photo", "album", "share", "link"]).has(type)) {
      review.add("unsupported_media");
    }
    output.push({
      ...(type === undefined ? {} : { type }),
      ...(id === undefined ? {} : { id }),
      ...(url === undefined ? {} : { url }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    });
    collectAttachments(candidate.subattachments, output, review, depth + 1);
  }
}

export function parseFacebookPost(value: unknown, pageId: string): FacebookPost {
  if (!/^[1-9]\d*$/.test(pageId) || !isRecord(value) || typeof value.id !== "string" ||
      !/^\d+_\d+$/.test(value.id) || !value.id.startsWith(`${pageId}_`)) {
    throw new FacebookContentError("invalid_post_id");
  }
  const review = new Set<string>();
  const message = optionalString(value.message);
  const publishedAt = timestamp(value.created_time);
  const updatedAt = timestamp(value.updated_time);
  const permalink = publicUrl(value.permalink_url, true);
  if (value.message !== undefined && message === undefined) {
    review.add("invalid_text");
  }
  if (!message?.trim()) {
    review.add("missing_text");
  }
  if (!publishedAt) {
    review.add(value.created_time === undefined ? "missing_publication_time" : "invalid_publication_time");
  }
  if (value.updated_time !== undefined && !updatedAt) {
    review.add("invalid_update_time");
  }
  if (!permalink) {
    review.add(value.permalink_url === undefined ? "missing_permalink" : "invalid_permalink");
  }
  const attachments: FacebookAttachment[] = [];
  collectAttachments(value.attachments, attachments, review);
  if (!message?.trim() && attachments.length > 0) {
    review.add("media_only");
  }
  return {
    id: value.id,
    pageId,
    ...(message === undefined ? {} : { message }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(permalink === undefined ? {} : { permalink }),
    attachments,
    reviewReasons: [...review],
  };
}

function normalizedPayload(post: FacebookPost): JsonValue {
  return {
    kind: "facebook-page-post",
    version: 1,
    post: {
      id: post.id,
      pageId: post.pageId,
      ...(post.message === undefined ? {} : { message: post.message }),
      ...(post.publishedAt === undefined ? {} : { publishedAt: post.publishedAt }),
      ...(post.updatedAt === undefined ? {} : { updatedAt: post.updatedAt }),
      ...(post.permalink === undefined ? {} : { permalink: post.permalink }),
      attachments: post.attachments.map((attachment) => {
        return { ...attachment };
      }),
      reviewReasons: [...post.reviewReasons],
    },
  };
}

export function toDiscoveredItem(post: FacebookPost): DiscoveredItem {
  const item = {
    identifier: `facebook:${post.pageId}:${post.id}`,
    ...(post.updatedAt === undefined ? {} : { observedAt: post.updatedAt }),
  };
  const payload = normalizedPayload(post);
  try {
    serializeDiscoveryPayload(payload);
    return { ...item, payload };
  } catch (error) {
    if (error instanceof RangeError) {
      return item;
    }
    throw new FacebookContentError("invalid_payload");
  }
}

function knownKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => {
    return keys.includes(key);
  });
}

function readAttachment(value: unknown): FacebookAttachment {
  if (!isRecord(value) || !knownKeys(value, ["type", "id", "url", "width", "height"])) {
    throw new FacebookContentError("invalid_payload");
  }
  const output: FacebookAttachment = {};
  for (const key of ["type", "id", "url"] as const) {
    const field = value[key];
    if (field !== undefined) {
      if (typeof field !== "string" || (key === "url" && publicUrl(field) !== field)) {
        throw new FacebookContentError("invalid_payload");
      }
      output[key] = field;
    }
  }
  for (const key of ["width", "height"] as const) {
    const field = value[key];
    if (field !== undefined) {
      if (typeof field !== "number" || !Number.isFinite(field) || field < 0) {
        throw new FacebookContentError("invalid_payload");
      }
      output[key] = field;
    }
  }
  return output;
}

const reviewReasons = new Set([
  "invalid_text", "missing_text", "missing_publication_time", "invalid_publication_time",
  "invalid_update_time", "missing_permalink", "invalid_permalink", "incomplete_attachment",
  "unsupported_media", "media_only",
]);

export function readDiscoveryPayload(item: DiscoveredItem, pageId: string): FacebookPost | undefined {
  if (item.payload === undefined) {
    return undefined;
  }
  const payload: unknown = item.payload;
  try {
    serializeDiscoveryPayload(payload);
  } catch {
    throw new FacebookContentError("invalid_payload");
  }
  if (!isRecord(payload) || !knownKeys(payload, ["kind", "version", "post"]) ||
      payload.kind !== "facebook-page-post" || payload.version !== 1 || !isRecord(payload.post)) {
    throw new FacebookContentError("invalid_payload");
  }
  const post = payload.post;
  if (!knownKeys(post, ["id", "pageId", "message", "publishedAt", "updatedAt", "permalink", "attachments", "reviewReasons"]) ||
      post.pageId !== pageId || typeof post.id !== "string" || !/^\d+_\d+$/.test(post.id) ||
      !post.id.startsWith(`${pageId}_`) || item.identifier !== `facebook:${pageId}:${post.id}` ||
      !isList(post.attachments) || post.attachments.length > 100 || !isList(post.reviewReasons)) {
    throw new FacebookContentError("invalid_payload");
  }
  const fields: { message?: string; publishedAt?: string; updatedAt?: string; permalink?: string } = {};
  for (const key of ["message", "publishedAt", "updatedAt", "permalink"] as const) {
    const field = post[key];
    if (field !== undefined) {
      if (typeof field !== "string" ||
          ((key === "publishedAt" || key === "updatedAt") && timestamp(field) !== field) ||
          (key === "permalink" && publicUrl(field, true) !== field)) {
        throw new FacebookContentError("invalid_payload");
      }
      fields[key] = field;
    }
  }
  const reasons: string[] = [];
  for (const reason of post.reviewReasons) {
    if (typeof reason !== "string" || !reviewReasons.has(reason)) {
      throw new FacebookContentError("invalid_payload");
    }
    reasons.push(reason);
  }
  return {
    id: post.id,
    pageId,
    ...fields,
    attachments: post.attachments.map(readAttachment),
    reviewReasons: reasons,
  };
}

export function toSourceContent(post: FacebookPost): SourceContent {
  if (!post.message?.trim()) {
    throw new FacebookContentError("missing_text", post);
  }
  if (!post.publishedAt || timestamp(post.publishedAt) !== post.publishedAt) {
    throw new FacebookContentError("missing_publication_time", post);
  }
  if (!post.permalink || publicUrl(post.permalink, true) !== post.permalink) {
    throw new FacebookContentError("missing_permalink", post);
  }
  const firstLine = post.message.split(/\r\n?|\n/).find((line) => {
    return line.trim().length > 0;
  })?.trim() ?? "";
  const title = Array.from(firstLine).slice(0, 180).join("");
  return {
    title,
    message: post.message,
    datePublished: post.publishedAt,
    deepLinkUrl: post.permalink,
  };
}
