import { codeToHtml } from "shiki";
import { CLOUDROUTER_SKILL_CONTENT_CLASS } from "./code-block-styles";
import { CopyButton } from "./copy-button";

const SKILL_URL =
  "https://raw.githubusercontent.com/manaflow-ai/cloudrouter/main/skills/cloudrouter/SKILL.md";

async function fetchSkillContent() {
  const res = await fetch(SKILL_URL, { next: { revalidate: 60 } });
  const raw = await res.text();
  return raw.replace(/^---[\s\S]*?---\n/, "");
}

export async function SkillContent() {
  const content = await fetchSkillContent();

  const html = await codeToHtml(content, {
    lang: "markdown",
    themes: {
      light: "github-light",
      dark: "github-dark-dimmed",
    },
    defaultColor: "light",
  });

  return (
    <div className="min-w-0">
      <div className="relative min-w-0">
        <div
          className={CLOUDROUTER_SKILL_CONTENT_CLASS}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div className="absolute right-3 top-4">
          <CopyButton text={content} />
        </div>
      </div>
    </div>
  );
}
