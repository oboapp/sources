export function decodeHtmlEntities(s: string): string {
  return s.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }

      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }

      const namedEntities: Record<string, string> = {
        amp: "&",
        apos: "'",
        bdquo: '"',
        gt: ">",
        hellip: "...",
        ldquo: '"',
        lsquo: "'",
        lt: "<",
        mdash: "-",
        nbsp: " ",
        ndash: "-",
        quot: '"',
        rdquo: '"',
        rsquo: "'",
      };

      return namedEntities[entity] ?? match;
    },
  );
}
