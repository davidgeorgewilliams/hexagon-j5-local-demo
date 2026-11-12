import { Undo2, Redo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
const escaped = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function RichText({
  html,
  text,
  onChange,
  disabled = false,
}: {
  html?: string;
  text: string;
  onChange: (html: string, text: string) => void;
  disabled?: boolean;
}) {
  const editor = useRef<HTMLDivElement>(null),
    [link, setLink] = useState(""),
    [linkOpen, setLinkOpen] = useState(false),
    [plain, setPlain] = useState(false);
  const selection = useRef<Range | null>(null);
  useEffect(() => {
    const content = html || escaped(text).replaceAll("\n", "<br>");
    if (editor.current && editor.current.innerHTML !== content)
      editor.current.innerHTML = content;
  }, [html, text, plain]);
  const emit = () => {
    if (editor.current)
      onChange(editor.current.innerHTML, editor.current.innerText);
  };
  const command = (name: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, value);
    emit();
  };
  return (
    <div className="j5-rich-editor">
      <div className="j5-tools" role="toolbar" aria-label="Message formatting">
        {(
          [
            ["bold", "Bold", "B"],
            ["italic", "Italic", "I"],
            ["underline", "Underline", "U"],
            ["insertUnorderedList", "Bullet list", "• List"],
            ["insertOrderedList", "Numbered list", "1. List"],
            ["formatBlock", "Heading", "Heading"],
            ["removeFormat", "Clear formatting", "Clear"],
            ["undo", "Undo formatting", "↶"],
            ["redo", "Redo formatting", "↷"],
          ] as const
        ).map(([cmd, label, glyph]) => (
          <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled || plain}
            key={cmd}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() =>
              command(cmd, cmd === "formatBlock" ? "h3" : undefined)
            }
          >
            {cmd === "undo" ? (
              <Undo2 size={13} />
            ) : cmd === "redo" ? (
              <Redo2 size={13} />
            ) : (
              glyph
            )}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || plain}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const sel = window.getSelection();
            selection.current = sel?.rangeCount
              ? sel.getRangeAt(0).cloneRange()
              : null;
            setLinkOpen(!linkOpen);
          }}
        >
          Link
        </button>
        <button type="button" onClick={() => setPlain(!plain)}>
          {plain ? "Rich text" : "Plain text"}
        </button>
      </div>
      {linkOpen && (
        <div className="j5-tools">
          <input
            aria-label="Link URL"
            type="url"
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button
            type="button"
            disabled={!/^(https?:\/\/|mailto:)/i.test(link)}
            onClick={() => {
              editor.current?.focus();
              if (selection.current) {
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(selection.current);
              }
              command("createLink", link);
              setLinkOpen(false);
              setLink("");
            }}
          >
            Insert link
          </button>
        </div>
      )}
      {plain ? (
        <textarea
          aria-label="Operational message"
          disabled={disabled}
          value={text}
          maxLength={10000}
          onChange={(e) => onChange("", e.target.value)}
        />
      ) : (
        <div
          ref={editor}
          role="textbox"
          aria-label="Operational message"
          aria-multiline="true"
          contentEditable={!disabled}
          suppressContentEditableWarning
          className="j5-rich-content"
          onInput={emit}
          onPaste={(e) => {
            e.preventDefault();
            command("insertText", e.clipboardData.getData("text/plain"));
          }}
          onDrop={(e) => e.preventDefault()}
        />
      )}
      <small>
        {text.length.toLocaleString()} / 10,000 characters · Formatting is
        preserved on save
      </small>
    </div>
  );
}
