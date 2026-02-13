import { codeToHtml } from "shiki";
import { CLOUDROUTER_CODE_BLOCK_CLASS } from "./code-block-styles";
import { CopyButton } from "./copy-button";

export async function CodeBlock({
  children,
  lang = "bash",
}: {
  children: string;
  lang?: string;
}) {
  const html = await codeToHtml(children, {
    lang: ["bash", "sh", "markdown", "md"].includes(lang) ? lang : "text",
    themes: {
      light: "github-light",
      dark: "github-dark-dimmed",
    },
    defaultColor: "light",
  });

  return (
    <div className="relative min-w-0">
      <div
        className={CLOUDROUTER_CODE_BLOCK_CLASS}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="absolute right-3 top-4">
        <CopyButton text={children} />
      </div>
    </div>
  );
}
