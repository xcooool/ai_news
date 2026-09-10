import test from "node:test";
import assert from "node:assert/strict";
import { plainText, summarizeItem } from "../lib/plain-text.mjs";

test("plainText strips HTML and decodes entities", () => {
  const html = '<table><tr><td><a href="https://reddit.com/r/test">Hello &amp; world</a></td></tr></table>';
  assert.equal(plainText(html), "Hello & world");
});

test("summarizeItem prefers readable text over html tagline", () => {
  const item = {
    name: "Show HN title",
    tagline: "<div><p>First paragraph about AI agents.</p></div>",
    content: { text: "Clean fallback summary about AI agents." },
  };
  assert.match(summarizeItem(item), /AI agents/);
  assert.doesNotMatch(summarizeItem(item), /</);
});
