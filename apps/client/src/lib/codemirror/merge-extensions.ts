import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import {
  StreamLanguage,
  HighlightStyle,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css as cssLanguage } from "@codemirror/lang-css";
import { html as htmlLanguage } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { go as goLanguage } from "@codemirror/lang-go";
import { java as javaLanguage } from "@codemirror/lang-java";
import { php as phpLanguage } from "@codemirror/lang-php";
import { xml as xmlLanguage } from "@codemirror/lang-xml";
import { yaml as yamlLanguage } from "@codemirror/lang-yaml";
import { cpp } from "@codemirror/lang-cpp";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import {
  c as clikeC,
  csharp as clikeCsharp,
  kotlin as clikeKotlin,
  scala as clikeScala,
} from "@codemirror/legacy-modes/mode/clike";
import { ruby as rubyLanguage } from "@codemirror/legacy-modes/mode/ruby";
import { swift as swiftLanguage } from "@codemirror/legacy-modes/mode/swift";
import { dockerFile as dockerfileLanguage } from "@codemirror/legacy-modes/mode/dockerfile";
import { sass as legacySass } from "@codemirror/legacy-modes/mode/sass";
import { toml as tomlLanguage } from "@codemirror/legacy-modes/mode/toml";

import { getDiffColorPalette } from "@/lib/diff-colors";

import {
  diffLineNumberMarkers,
  LINE_NUMBER_ADDITION_CLASS,
  LINE_NUMBER_DELETION_CLASS,
} from "./diff-line-number-markers";

const darkHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.moduleKeyword],
    color: "#f472b6",
  },
  {
    tag: [t.typeName, t.className, t.tagName, t.attributeName],
    color: "#38bdf8",
  },
  {
    tag: [t.string, t.special(t.string), t.character],
    color: "#fbbf24",
  },
  {
    tag: [t.number, t.bool, t.null, t.atom],
    color: "#facc15",
  },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    color: "#c4b5fd",
  },
  {
    tag: t.propertyName,
    color: "#5eead4",
  },
  {
    tag: t.comment,
    color: "#9ca3af",
    fontStyle: "italic",
  },
  {
    tag: [t.operator, t.punctuation],
    color: "#fb7185",
  },
]);

export function createMergeBaseExtensions(
  theme: string | undefined,
): Extension[] {
  const isDark = theme === "dark";
  const palette = getDiffColorPalette(isDark ? "dark" : "light");
  const textColor = isDark ? "#e5e7eb" : "#1f2937";
  const gutterColor = isDark ? "#9ca3af" : "#6b7280";

  const baseTheme = EditorView.theme(
    {
      "&": {
        fontFamily:
          "'Menlo', 'JetBrains Mono', 'SF Mono', Monaco, 'Courier New', monospace",
        fontSize: "12px",
        lineHeight: "18px",
        backgroundColor: "transparent",
        color: textColor,
      },
      ".cm-scroller": {
        fontFamily:
          "'Menlo', 'JetBrains Mono', 'SF Mono', Monaco, 'Courier New', monospace",
        lineHeight: "18px",
      },
      ".cm-content": {
        padding: "2px 0",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        border: "none",
        color: gutterColor,
        position: "relative",
      },
      ".cm-gutters.cm-gutters-before": {
        position: "relative",
      },
      ".cm-gutters.cm-gutters-before .cm-gutter.cm-changeGutter": {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        width: "100%",
        zIndex: 0,
      },
      ".cm-gutterElement": {
        padding: "0 8px",
        position: "relative",
        zIndex: 1,
      },
      ".cm-lineNumbers .cm-gutterElement": {
        fontSize: "11px",
      },
      [`.cm-lineNumbers .cm-gutterElement.${LINE_NUMBER_ADDITION_CLASS}`]: {
        color: palette.addition.lineNumberForeground,
      },
      [`.cm-lineNumbers .cm-gutterElement.${LINE_NUMBER_DELETION_CLASS}`]: {
        color: palette.deletion.lineNumberForeground,
      },
      ".cm-activeLine": {
        backgroundColor: isDark
          ? "rgba(255, 255, 255, 0.04)"
          : "rgba(15, 23, 42, 0.04)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: isDark ? "#d4d4d8" : "#4b5563",
      },
      ".cm-selectionBackground, & ::selection": {
        backgroundColor: "rgba(148, 163, 184, 0.35)",
      },
      "& .cm-mergeView": {
        backgroundColor: "transparent",
      },
      "& .cm-mergeView .cm-editor": {
        backgroundColor: "transparent",
      },
      "& .cm-mergeViewEditors": {
        backgroundColor: "transparent",
      },
      "&.cm-merge-a": {
        borderRight: `1px solid ${isDark ? "#27272a" : "#e5e5e5"}`,
      },
      ".cm-change.cm-change-insert": {
        backgroundColor: palette.addition.textBackground,
        textDecoration: "none",
      },
      ".cm-change.cm-change-delete": {
        backgroundColor: palette.deletion.textBackground,
        textDecoration: "none",
      },
      ".cm-mergeView ins.cm-insertedLine": {
        textDecoration: "none",
        backgroundColor: palette.addition.textBackground,
      },
      ".cm-mergeView del.cm-deletedLine": {
        textDecoration: "none",
        backgroundColor: palette.deletion.textBackground,
      },
      ".cm-collapsedLines": {
        backgroundColor: palette.collapsed.background,
        color: palette.collapsed.foreground,
        padding: "5px 5px 5px 10px",
        cursor: "pointer",
        backgroundImage: "none",
      },
      ".cm-mergeSpacer": {
        backgroundColor: isDark ? "rgba(148, 163, 184, 0.18)" : "#f6f8fa",
      },
      "&.cm-merge-b .cm-changedLine": {
        backgroundColor: palette.addition.lineBackground,
      },
      "&.cm-merge-a .cm-changedLine": {
        backgroundColor: palette.deletion.lineBackground,
      },
      "&.cm-merge-b .cm-inlineChangedLine": {
        backgroundColor: palette.addition.lineBackground,
      },
      "&.cm-merge-a .cm-inlineChangedLine": {
        backgroundColor: palette.deletion.lineBackground,
      },
      "& .cm-deletedChunk": {
        backgroundColor: palette.deletion.lineBackground,
      },
      "& .cm-insertedChunk": {
        backgroundColor: palette.addition.lineBackground,
      },
      "&.cm-merge-b .cm-gutterElement.cm-changedLineGutter": {
        backgroundColor: palette.addition.gutterBackground,
      },
      "&.cm-merge-a .cm-gutterElement.cm-changedLineGutter": {
        backgroundColor: palette.deletion.gutterBackground,
      },
      "&.cm-merge-b .cm-changedText": {
        background: "none",
        textDecoration: "none",
      },
      "&.cm-merge-a .cm-changedText": {
        background: "none",
        textDecoration: "none",
      },
    },
    { dark: isDark },
  );

  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    diffLineNumberMarkers,
    highlightActiveLine(),
    highlightActiveLineGutter(),
    lineNumbers(),
    syntaxHighlighting(isDark ? darkHighlightStyle : defaultHighlightStyle, {
      fallback: true,
    }),
    baseTheme,
  ];
}

export function getLanguageExtensions(path: string): Extension[] {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
      return [javascript({ typescript: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "js":
      return [javascript()];
    case "jsx":
      return [javascript({ jsx: true })];
    case "json":
      return [json()];
    case "md":
    case "markdown":
      return [markdown()];
    case "css":
      return [cssLanguage()];
    case "scss":
    case "sass":
      return [StreamLanguage.define(legacySass)];
    case "html":
    case "htm":
      return [htmlLanguage()];
    case "xml":
      return [xmlLanguage()];
    case "yaml":
    case "yml":
      return [yamlLanguage()];
    case "py":
      return [python()];
    case "rs":
      return [rust()];
    case "go":
      return [goLanguage()];
    case "java":
      return [javaLanguage()];
    case "php":
      return [phpLanguage()];
    case "sql":
      return [sql()];
    case "rb":
      return [StreamLanguage.define(rubyLanguage)];
    case "swift":
      return [StreamLanguage.define(swiftLanguage)];
    case "kt":
    case "kts":
      return [StreamLanguage.define(clikeKotlin)];
    case "scala":
      return [StreamLanguage.define(clikeScala)];
    case "cs":
    case "csharp":
      return [StreamLanguage.define(clikeCsharp)];
    case "c":
    case "h":
      return [StreamLanguage.define(clikeC)];
    case "cpp":
    case "cxx":
    case "cc":
    case "hpp":
    case "hxx":
    case "hh":
      return [cpp()];
    case "sh":
    case "bash":
    case "zsh":
      return [StreamLanguage.define(shell)];
    case "toml":
      return [StreamLanguage.define(tomlLanguage)];
    case "dockerfile":
    case "docker":
      return [StreamLanguage.define(dockerfileLanguage)];
    default:
      return [];
  }
}

export {
  diffLineNumberMarkers,
  LINE_NUMBER_ADDITION_CLASS,
  LINE_NUMBER_DELETION_CLASS,
};
