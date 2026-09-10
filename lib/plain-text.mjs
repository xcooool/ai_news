const ENTITY = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function plainText(value, maxLength = 0) {
  if (value === null || value === undefined) return "";
  let text = String(value)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+);/gi, (_, name) => ENTITY[name.toLowerCase()] ?? `&${name};`)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
  if (maxLength > 0) text = text.slice(0, maxLength);
  return text;
}

export function summarizeItem(item, maxLength = 240) {
  if (!item) return "";
  const parts = [item.tagline, item.content?.text, item.content?.html, item.name];
  for (const part of parts) {
    const text = plainText(part, maxLength);
    if (text.length >= 8) return text;
  }
  return plainText(parts.find(Boolean), maxLength);
}
