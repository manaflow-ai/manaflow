import { describe, expect, it } from "vitest";

import {
  SimpleReviewParser,
  type SimpleReviewParsedEvent,
} from "./simple-review-parser";

type SimpleReviewLineEvent = Extract<
  SimpleReviewParsedEvent,
  { type: "line" }
>;

function collectLineEvents(
  chunks: readonly string[],
): SimpleReviewLineEvent[] {
  const parser = new SimpleReviewParser("example/file.ts");
  const events: SimpleReviewParsedEvent[] = [];

  for (const chunk of chunks) {
    events.push(...parser.push(chunk));
  }

  events.push(...parser.flush());

  return events.filter(
    (event): event is SimpleReviewLineEvent => event.type === "line",
  );
}

describe("SimpleReviewParser", () => {
  it("parses original quoted annotation format", () => {
    const events = collectLineEvents([
      '+ const foo = 1; # "foo" "initial assignment" "75"\n',
    ]);

    expect(events).toHaveLength(1);
    const line = events[0];

    expect(line.line.mostImportantWord).toBe("foo");
    expect(line.line.shouldReviewWhy).toBe("initial assignment");
    expect(line.line.score).toBe(75);
    expect(line.line.scoreNormalized).toBe(0.75);
    expect(line.line.diffLine).toBe('+ const foo = 1;');
    expect(line.line.codeLine).toBe(' const foo = 1;');
  });

  it("parses relaxed annotation format without quoted score or word", () => {
    const events = collectLineEvents([
      '+ console.log("nested"); # console too chatty 5\n',
    ]);

    expect(events).toHaveLength(1);
    const line = events[0];

    expect(line.line.mostImportantWord).toBe("console");
    expect(line.line.shouldReviewWhy).toBe("too chatty");
    expect(line.line.score).toBe(5);
    expect(line.line.scoreNormalized).toBeCloseTo(0.05);
  });

  it("parses annotations that contain mixed quoted fields", () => {
    const events = collectLineEvents([
      '+ # Nested Heading # "documentation file creation" "new documentation file" 15\n',
    ]);

    expect(events).toHaveLength(1);
    const line = events[0];

    expect(line.line.mostImportantWord).toBe("documentation file creation");
    expect(line.line.shouldReviewWhy).toBe("new documentation file");
    expect(line.line.score).toBe(15);
    expect(line.line.diffLine).toBe('+ # Nested Heading');
  });
});
