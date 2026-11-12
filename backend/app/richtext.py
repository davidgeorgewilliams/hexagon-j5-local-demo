"""Small allowlisted rich-text format. No active content, CSS, images or embeds."""

from html import escape
from html.parser import HTMLParser
from urllib.parse import urlsplit

TAGS = {
    "p",
    "div",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h2",
    "h3",
    "a",
    "code",
    "pre",
}
BLOCKS = {"p", "div", "li", "blockquote", "h2", "h3", "pre"}


class Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.html, self.text, self.stack = [], [], []
        self.suppressed = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "iframe", "object", "svg", "math", "template"}:
            self.suppressed += 1
            return
        if self.suppressed or tag not in TAGS:
            return
        attr = ""
        if tag == "a":
            href = dict(attrs).get("href", "") or ""
            try:
                scheme = urlsplit(href.strip()).scheme.lower()
            except ValueError:
                scheme = ""
            if scheme in {
                "https",
                "http",
                "mailto",
            } and not any(ord(c) < 32 for c in href):
                attr = f' href="{escape(href, quote=True)}" rel="noopener noreferrer" target="_blank"'
        self.html.append(f"<{tag}{attr}>")
        if tag == "br":
            self.text.append("\n")
        else:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in {"script", "style", "iframe", "object", "svg", "math", "template"}:
            self.suppressed = max(0, self.suppressed - 1)
            return
        if self.suppressed or tag not in self.stack:
            return
        while self.stack:
            current = self.stack.pop()
            self.html.append(f"</{current}>")
            if current in BLOCKS:
                self.text.append("\n")
            if current == tag:
                break

    def handle_data(self, data):
        if not self.suppressed:
            self.html.append(escape(data))
            self.text.append(data)


def sanitize_html(value):
    parser = Sanitizer()
    parser.feed(value)
    parser.close()
    for tag in reversed(parser.stack):
        parser.html.append(f"</{tag}>")
    return "".join(parser.html), "".join(parser.text).strip()
