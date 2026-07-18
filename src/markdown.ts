/**
 * A small, safe Markdown → HTML renderer for the reader's **Read** view.
 *
 * Adapted from the GrandsTech Reader's Read mode (which uses `marked` +
 * github-markdown.css), but self-contained: no dependency, and styled with the
 * app's own theme instead of the 25 KB GitHub sheet. It is intentionally *not* a
 * full CommonMark implementation — just enough to read a document cleanly
 * (headings, lists, emphasis, inline code, fenced code, links, quotes, rules).
 *
 * It also highlights our `@[label]` link tokens as chips, so the Read view
 * previews what will become `part-of` connections when the document is exploded.
 *
 * All text is HTML-escaped; link hrefs are restricted to safe schemes.
 */

// Runtime-only sentinel (private-use char, built at runtime so no odd literal
// lands in the source file) used to shield inline code from later passes.
const SEP = String.fromCharCode(0xe000);

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** Inline formatting: code, links, bold/italic, and our @[label] chips. */
function inline(text: string): string {
  const codes: string[] = [];
  // Pull inline code out first so its contents aren't re-formatted.
  let s = text.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return `${SEP}${codes.length - 1}${SEP}`;
  });
  s = escapeHtml(s);
  // Links [text](url) — only safe schemes, else neutralised.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, url: string) => {
    const u = url.trim();
    const safe = /^(https?:|mailto:|#|\/|\.)/i.test(u) ? u : "#";
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_([^_\s][^_]*?)_/g, "$1<em>$2</em>");
  // Our intra-map link token → highlighted chip (reserved [[ ]] left literal).
  s = s.replace(/@\[([^\]]+)\]/g, '<span class="ndmm-md-link">@[$1]</span>');
  // Restore protected code spans.
  s = s.replace(new RegExp(`${SEP}(\\d+)${SEP}`, "g"), (_m, i: string) => codes[Number(i)]);
  return s;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let para: string[] = [];
  const openLists: { ordered: boolean; indent: number }[] = [];

  const flushPara = (): void => {
    if (para.length) { html.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
  };
  const closeLists = (toIndent = -1): void => {
    while (openLists.length && openLists[openLists.length - 1].indent > toIndent) {
      html.push(openLists.pop()!.ordered ? "</ol>" : "</ul>");
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flushPara(); closeLists(); continue; }

    // Fenced code block.
    const fence = trimmed.match(/^```+\s*(\w+)?$/);
    if (fence) {
      flushPara(); closeLists();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```+\s*$/.test(lines[i].trim())) { body.push(lines[i]); i++; }
      html.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    // Heading.
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); closeLists(); html.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`); continue; }

    // Horizontal rule.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushPara(); closeLists(); html.push("<hr>"); continue; }

    // Blockquote (gather consecutive `>` lines).
    if (/^>\s?/.test(trimmed)) {
      flushPara(); closeLists();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { quote.push(lines[i].trim().replace(/^>\s?/, "")); i++; }
      i--;
      html.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }

    // List item (ordered or unordered), nested by indent.
    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const indent = li[1].replace(/\t/g, "  ").length;
      const ordered = /\d/.test(li[2]);
      closeLists(indent);
      const top = openLists[openLists.length - 1];
      if (!top || top.indent < indent) {
        html.push(ordered ? "<ol>" : "<ul>");
        openLists.push({ ordered, indent });
      }
      html.push(`<li>${inline(li[3].trim())}</li>`);
      continue;
    }

    // Otherwise: paragraph text (a non-list line ends any open list).
    if (openLists.length) closeLists();
    para.push(trimmed);
  }
  flushPara();
  closeLists();
  return html.join("\n");
}
