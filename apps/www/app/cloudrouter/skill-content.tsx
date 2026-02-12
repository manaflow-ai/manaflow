import { marked } from "marked";
import type { Token, Tokens } from "marked";
import { CodeBlock } from "./code-block";

const SKILL_URL =
  "https://raw.githubusercontent.com/manaflow-ai/cloudrouter/main/skills/cloudrouter/SKILL.md";

async function fetchSkillTokens() {
  const res = await fetch(SKILL_URL, { next: { revalidate: 60 } });
  const raw = await res.text();
  const content = raw.replace(/^---[\s\S]*?---\n/, "");
  return marked.lexer(content);
}

function renderInlineTokens(inlineTokens: Token[]): React.ReactNode[] {
  return inlineTokens.map((token, i) => {
    switch (token.type) {
      case "text":
        return <span key={i}>{(token as Tokens.Text).text}</span>;
      case "strong": {
        const s = token as Tokens.Strong;
        return (
          <strong
            key={i}
            className="font-semibold text-neutral-800 dark:text-neutral-200"
          >
            {renderInlineTokens(s.tokens)}
          </strong>
        );
      }
      case "em": {
        const e = token as Tokens.Em;
        return <em key={i}>{renderInlineTokens(e.tokens)}</em>;
      }
      case "codespan":
        return (
          <code
            key={i}
            className="rounded bg-neutral-100 px-1 py-0.5 text-[0.85em] dark:bg-neutral-800"
          >
            {(token as Tokens.Codespan).text}
          </code>
        );
      case "link": {
        const l = token as Tokens.Link;
        return (
          <a
            key={i}
            href={l.href}
            className="underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-500 dark:decoration-neutral-600 dark:hover:decoration-neutral-400"
          >
            {renderInlineTokens(l.tokens)}
          </a>
        );
      }
      case "escape":
        return <span key={i}>{(token as Tokens.Escape).text}</span>;
      case "br":
        return <br key={i} />;
      default:
        return <span key={i}>{token.raw}</span>;
    }
  });
}

function renderListItem(item: Tokens.ListItem): React.ReactNode {
  return item.tokens.map((token, j) => {
    if (token.type === "text") {
      const t = token as Tokens.Text;
      if (t.tokens) {
        return <span key={j}>{renderInlineTokens(t.tokens)}</span>;
      }
      return <span key={j}>{t.text}</span>;
    }
    if (token.type === "paragraph") {
      return (
        <span key={j}>
          {renderInlineTokens((token as Tokens.Paragraph).tokens)}
        </span>
      );
    }
    if (token.type === "list") {
      const l = token as Tokens.List;
      const Tag = l.ordered ? "ol" : "ul";
      return (
        <Tag
          key={j}
          className={`mt-1 space-y-1 pl-5 ${l.ordered ? "list-decimal" : "list-disc"}`}
        >
          {l.items.map((subItem, k) => (
            <li
              key={k}
              className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
            >
              {renderListItem(subItem)}
            </li>
          ))}
        </Tag>
      );
    }
    return null;
  });
}

function renderToken(token: Token, i: number): React.ReactNode {
  switch (token.type) {
    case "heading": {
      const h = token as Tokens.Heading;
      const id = h.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (h.depth === 1) {
        return (
          <h2
            key={i}
            id={id}
            className="mb-4 mt-10 scroll-mt-8 text-xl font-bold"
          >
            {renderInlineTokens(h.tokens)}
          </h2>
        );
      }
      if (h.depth === 2) {
        return (
          <h3
            key={i}
            id={id}
            className="mb-4 mt-8 scroll-mt-8 text-lg font-semibold"
          >
            {renderInlineTokens(h.tokens)}
          </h3>
        );
      }
      if (h.depth === 3) {
        return (
          <h4
            key={i}
            id={id}
            className="mb-3 mt-6 scroll-mt-8 text-base font-semibold"
          >
            {renderInlineTokens(h.tokens)}
          </h4>
        );
      }
      return (
        <h5
          key={i}
          id={id}
          className="mb-2 mt-4 scroll-mt-8 text-sm font-semibold"
        >
          {renderInlineTokens(h.tokens)}
        </h5>
      );
    }

    case "paragraph": {
      const p = token as Tokens.Paragraph;
      return (
        <p
          key={i}
          className="mb-4 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
        >
          {renderInlineTokens(p.tokens)}
        </p>
      );
    }

    case "code": {
      const c = token as Tokens.Code;
      return (
        <div key={i} className="mb-4">
          <CodeBlock lang={c.lang || "bash"}>{c.text}</CodeBlock>
        </div>
      );
    }

    case "table": {
      const t = token as Tokens.Table;
      return (
        <div key={i} className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                {t.header.map((cell, j) => (
                  <th
                    key={j}
                    className="px-3 py-2 text-left font-semibold text-neutral-900 dark:text-neutral-100"
                  >
                    {renderInlineTokens(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, j) => (
                <tr
                  key={j}
                  className="border-b border-neutral-100 dark:border-neutral-800/50"
                >
                  {row.map((cell, k) => (
                    <td
                      key={k}
                      className="px-3 py-2 text-neutral-600 dark:text-neutral-400"
                    >
                      {renderInlineTokens(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "blockquote": {
      const bq = token as Tokens.Blockquote;
      return (
        <blockquote
          key={i}
          className="mb-4 border-l-2 border-neutral-300 pl-4 dark:border-neutral-700"
        >
          {bq.tokens.map((t, j) => renderToken(t, j))}
        </blockquote>
      );
    }

    case "list": {
      const l = token as Tokens.List;
      const Tag = l.ordered ? "ol" : "ul";
      return (
        <Tag
          key={i}
          className={`mb-4 space-y-1 pl-5 ${l.ordered ? "list-decimal" : "list-disc"}`}
        >
          {l.items.map((item, j) => (
            <li
              key={j}
              className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
            >
              {renderListItem(item)}
            </li>
          ))}
        </Tag>
      );
    }

    case "hr":
      return (
        <hr
          key={i}
          className="my-8 border-neutral-200 dark:border-neutral-800"
        />
      );

    case "space":
      return null;

    default:
      return null;
  }
}

export async function SkillContent() {
  const tokens = await fetchSkillTokens();
  return (
    <div className="min-w-0">
      {tokens.map((token, i) => renderToken(token, i))}
    </div>
  );
}
