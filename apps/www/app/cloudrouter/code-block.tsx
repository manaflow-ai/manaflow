import { codeToHtml } from "shiki";
import { CopyButton } from "./copy-button";

export async function CodeBlock({
  children,
  lang = "bash",
}: {
  children: string;
  lang?: string;
}) {
  const html = await codeToHtml(children, {
    lang: lang === "bash" || lang === "sh" ? "bash" : "text",
    themes: {
      light: "github-light",
      dark: "github-dark-dimmed",
    },
    defaultColor: "light",
  });

  return (
    <div className="relative min-w-0">
      <div
        className="overflow-x-auto rounded-lg border border-neutral-200 text-sm leading-relaxed dark:border-neutral-800 [&_pre]:!m-0 [&_pre]:!rounded-lg [&_pre]:!p-4 [&_pre]:!pr-12"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <div className="absolute right-3 top-0 flex h-full pt-3">
        <CopyButton text={children} />
      </div>
    </div>
  );
}
