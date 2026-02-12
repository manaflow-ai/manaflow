import { CodeBlock } from "./code-block";

const SKILL_URL =
  "https://raw.githubusercontent.com/manaflow-ai/cloudrouter/main/skills/cloudrouter/SKILL.md";

async function fetchSkillContent() {
  const res = await fetch(SKILL_URL, { next: { revalidate: 60 } });
  const raw = await res.text();
  return raw.replace(/^---[\s\S]*?---\n/, "");
}

export async function SkillContent() {
  const content = await fetchSkillContent();
  return (
    <div className="min-w-0">
      <CodeBlock lang="markdown">{content}</CodeBlock>
    </div>
  );
}
