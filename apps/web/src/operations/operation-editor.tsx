"use client";

import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { graphql } from "cm6-graphql";
import { buildSchema } from "graphql";
import { useEffect, useRef } from "react";

interface OperationEditorProps {
  id: string;
  label: string;
  /** The text the editor starts with. Later edits belong to the editor. */
  initialValue: string;
  /** The graph's schema, for completion and for marking fields that don't exist. */
  schemaSdl: string;
  onChange: (value: string) => void;
}

const MAX_SUGGESTIONS = 8;

// Colours come from the semantic tokens, so the editor follows the theme, and every pair used
// here is one the contrast tests already hold to AA on a surface.
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.definitionKeyword], color: "var(--brand-fg)" },
  { tag: [tags.string, tags.number, tags.bool], color: "var(--success)" },
  { tag: [tags.variableName, tags.atom], color: "var(--info)" },
  { tag: tags.comment, color: "var(--fg-muted)" },
]);

const theme = EditorView.theme({
  "&": { backgroundColor: "var(--surface)", color: "var(--fg)" },
  "&.cm-focused": { outline: "0.125rem solid var(--focus-ring)", outlineOffset: "0.125rem" },
  ".cm-content": { caretColor: "var(--fg)", fontFamily: "ui-monospace, monospace" },
  ".cm-cursor": { borderLeftColor: "var(--fg)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--brand-soft)",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--surface)",
    color: "var(--fg)",
    border: "0.0625rem solid var(--fg-subtle)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--brand)",
    color: "var(--on-brand)",
  },
  ".cm-completionDetail": { color: "inherit" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { maxHeight: "none", overflow: "visible" },
});

/**
 * A GraphQL editor on CodeMirror 6 (ADR 0018). Tab is left alone, so it moves focus on as it does
 * everywhere else, and a keyboard user is never held inside the editor.
 */
export function OperationEditor({
  id,
  label,
  initialValue,
  schemaSdl,
  onChange,
}: OperationEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const initial = useRef(initialValue);
  const changed = useRef(onChange);

  useEffect(() => {
    changed.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const view = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          graphql(buildSchema(schemaSdl)),
          // cm6-graphql only supplies the suggestions. This shows them, on typing and on
          // Ctrl+Space, and lets the arrow keys, Enter and Escape work the list from the editor.
          // The list is short and shown whole: a list that scrolls would need its own keyboard
          // focus, and focus has to stay in the editor.
          autocompletion({ maxRenderedOptions: MAX_SUGGESTIONS }),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-labelledby": `${id}-label` }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changed.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    return () => {
      view.destroy();
    };
  }, [id, schemaSdl]);

  return (
    <div>
      <span id={`${id}-label`} className="mb-1 block text-subtitle">
        {label}
      </span>
      <div
        id={id}
        ref={host}
        className="overflow-hidden rounded-sm border border-fg-subtle text-caption"
      />
    </div>
  );
}
