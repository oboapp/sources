import { parseHTML } from "linkedom";
import type { Municipality } from "./types.js";

/** The provider sends the same municipality cards in its initial HTTP response. */
export function discoverMunicipalities(html: string): Municipality[] {
  const { document } = parseHTML(html);
  const header = Array.from(document.querySelectorAll("h5.card-title")).find((element) =>
    element.textContent?.includes("Област София-град"),
  );
  const cardBody = header?.closest("div.card-body");
  if (!cardBody) {
    return [];
  }
  const municipalities: Municipality[] = [];
  for (const item of Array.from(cardBody.querySelectorAll("ul.list-group li"))) {
    const onclick = item.getAttribute("onclick");
    if (!onclick) {
      continue;
    }
    const match = /show_obstina\('([^']+)'/.exec(onclick);
    if (!match) {
      continue;
    }
    const code = match[1];
    const text = item.textContent?.trim() || "";
    const nameMatch = /община\s+(.+)/i.exec(text);
    const name = nameMatch?.[1]?.trim() ?? text;
    if (code && name) {
      municipalities.push({ code, name });
    }
  }
  return municipalities;
}
