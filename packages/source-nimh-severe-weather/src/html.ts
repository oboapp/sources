export function stripHtmlTags(text: string, replacement: string = ""): string {
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
