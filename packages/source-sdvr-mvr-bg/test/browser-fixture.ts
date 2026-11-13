import { mock } from "node:test";
import type { Browser, Route } from "playwright";
import { Window } from "happy-dom";

export function browserFixture(indexUrl: string, listingHtml: string, detailHtml: string) {
  const window = new Window({ url: indexUrl });
  let currentHtml = listingHtml;
  let failNextDetail = false;
  let failNextListing = false;
  let navigationStatus = 200;
  const closePage = mock.fn(async () => {
    return undefined;
  });
  const closeBrowser = mock.fn(async () => {
    return undefined;
  });
  const goto = mock.fn(async (url: string, options: unknown) => {
    void options;
    if (url === indexUrl && failNextListing) {
      failNextListing = false;
      throw new Error("Listing navigation failed");
    }
    if (url !== indexUrl && failNextDetail) {
      failNextDetail = false;
      throw new Error("Detail navigation failed");
    }
    currentHtml = url === indexUrl ? listingHtml : detailHtml;
    const status = navigationStatus;
    navigationStatus = 200;
    return {
      ok() {
        return status >= 200 && status < 300;
      },
      status() {
        return status;
      },
    };
  });
  const route = mock.fn(async (pattern: string, handler: (route: Route) => Promise<void>) => {
    void pattern;
    void handler;
  });
  const evaluate = async (callback: (argument: unknown) => unknown, argument: unknown) => {
    window.document.body.innerHTML = currentHtml;
    const previousDocument = globalThis.document;
    const previousElement = globalThis.HTMLElement;
    const previousAnchor = globalThis.HTMLAnchorElement;
    Object.assign(globalThis, {
      document: window.document,
      HTMLElement: window.HTMLElement,
      HTMLAnchorElement: window.HTMLAnchorElement,
    });
    try {
      return callback(argument);
    } finally {
      Object.assign(globalThis, {
        document: previousDocument,
        HTMLElement: previousElement,
        HTMLAnchorElement: previousAnchor,
      });
    }
  };
  const page = { close: closePage, goto, route, evaluate };
  const newPage = mock.fn(async () => {
    return page;
  });
  const browser = { newPage, close: closeBrowser } as unknown as Browser;
  const launchBrowser = mock.fn(async () => {
    return browser;
  });
  const delay = mock.fn(async () => {
    return undefined;
  });
  return {
    launchBrowser,
    delay,
    newPage,
    closePage,
    closeBrowser,
    goto,
    document: window.document,
    failNextDetail() {
      failNextDetail = true;
    },
    failNextListing() {
      failNextListing = true;
    },
    setNavigationStatus(status: number) {
      navigationStatus = status;
    },
    setDetailHtml(html: string) {
      detailHtml = html;
    },
  };
}
