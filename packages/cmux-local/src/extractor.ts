/**
 * Extract questions and other structured data from Claude Code output
 */

import { nanoid } from "nanoid";
import { type Question } from "./types.js";

interface ExtractionResult {
  questions: Question[];
  decisions: string[];
  assumptions: string[];
}

/**
 * Extract structured data from tmux output
 */
export function extractQuestionsFromOutput(
  output: string,
  taskId: string
): ExtractionResult {
  const questions: Question[] = [];
  const decisions: string[] = [];
  const assumptions: string[] = [];

  // Look for explicit QUESTION: markers
  const questionMatches = output.matchAll(
    /QUESTION:\s*(.+?)(?:\n|$)/gi
  );
  for (const match of questionMatches) {
    const question = match[1].trim();
    if (question) {
      questions.push({
        id: nanoid(8),
        taskId,
        question,
        status: "open",
        askedAt: new Date(),
      });
    }
  }

  // Look for explicit DECISION: markers
  const decisionMatches = output.matchAll(
    /DECISION:\s*(.+?)(?:\n|$)/gi
  );
  for (const match of decisionMatches) {
    const decision = match[1].trim();
    if (decision) {
      decisions.push(decision);
    }
  }

  // Look for explicit ASSUMING: markers
  const assumptionMatches = output.matchAll(
    /ASSUMING:\s*(.+?)(?:\n|$)/gi
  );
  for (const match of assumptionMatches) {
    const assumption = match[1].trim();
    if (assumption) {
      assumptions.push(assumption);
    }
  }

  // Natural language fallback - look for question patterns
  // Only if we haven't found explicit markers
  if (questions.length === 0) {
    const naturalQuestions = output.matchAll(
      /(?:should I|would you like|do you want|which (?:one|approach)|can you (?:clarify|confirm)|what (?:should|would))[^.?]*\?/gi
    );
    for (const match of naturalQuestions) {
      const question = match[0].trim();
      if (question.length > 10 && question.length < 200) {
        questions.push({
          id: nanoid(8),
          taskId,
          question,
          status: "open",
          askedAt: new Date(),
        });
      }
    }
  }

  // Look for Claude Code's permission prompts
  const permissionMatches = output.matchAll(
    /(?:Allow|Approve|Confirm).*?\?\s*\[([^\]]+)\]/gi
  );
  for (const match of permissionMatches) {
    questions.push({
      id: nanoid(8),
      taskId,
      question: match[0],
      options: match[1].split("/").map((o) => o.trim()),
      status: "open",
      askedAt: new Date(),
    });
  }

  return { questions, decisions, assumptions };
}
