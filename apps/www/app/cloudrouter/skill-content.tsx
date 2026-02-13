import { codeToHtml } from "shiki";
import { CLOUDROUTER_SKILL_CONTENT_CLASS } from "./code-block-styles";
import { CopyButton } from "./copy-button";

const SKILL_URL =
  "https://raw.githubusercontent.com/manaflow-ai/cloudrouter/main/skills/cloudrouter/SKILL.md";

const MAILTO_SUBJECT = encodeURIComponent("GPU Access Request — cloudrouter");
const MAILTO_BODY = encodeURIComponent(
  `Hi Manaflow team,

I'd like to request access to GPU sandboxes on cloudrouter.

Team/Company:
Use case:
GPU type(s) needed:

Thanks!`,
);
const MAILTO_HREF = `mailto:founders@manaflow.com?subject=${MAILTO_SUBJECT}&body=${MAILTO_BODY}`;

const MAIL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:middle;margin-left:3px;"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;

async function fetchSkillContent() {
  const res = await fetch(SKILL_URL, { next: { revalidate: 60 } });
  const raw = await res.text();
  return raw.replace(/^---[\s\S]*?---\n/, "");
}

export async function SkillContent() {
  const content = await fetchSkillContent();

  let html = await codeToHtml(content, {
    lang: "markdown",
    themes: {
      light: "github-light",
      dark: "github-dark-dimmed",
    },
    defaultColor: "light",
  });

  // Replace "Requires approval" in the GPU table with a mailto link
  html = html.replace(
    /Requires approval/g,
    `<a href="${MAILTO_HREF}" style="text-decoration:underline;color:inherit;cursor:pointer;">Requires approval${MAIL_ICON_SVG}</a>`,
  );

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
