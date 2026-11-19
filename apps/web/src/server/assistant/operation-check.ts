import {
  buildSchema,
  Kind,
  OperationTypeNode,
  parse,
  validate,
  print,
  visit,
  type DocumentNode,
  type FieldNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from "graphql";
import { isPlainText } from "./plain-text.ts";

/** The public and sandbox routers' complexity limits, from `router/config.yaml` (C-45). */
export const ROUTER_LIMITS = { depth: 3, totalFields: 60, rootFields: 3, rootFieldAliases: 0 };

/** How deep the selections go, and how many fields they hold, counting through inline fragments. */
const measure = (
  set: SelectionSetNode | undefined,
  depth: number,
): { depth: number; fields: number } => {
  let deepest = depth;
  let fields = 0;
  for (const selection of set?.selections ?? []) {
    const level = selection.kind === Kind.FIELD ? depth + 1 : depth;
    if (selection.kind === Kind.FIELD) fields += 1;
    if (selection.kind === Kind.FIELD || selection.kind === Kind.INLINE_FRAGMENT) {
      const inner = measure(selection.selectionSet, level);
      deepest = Math.max(deepest, inner.depth, level);
      fields += inner.fields;
    }
  }
  return { depth: deepest, fields };
};

/** The fields at the root, through any inline fragments there, which the router counts as root. */
const rootFields = (set: SelectionSetNode): FieldNode[] =>
  set.selections.flatMap((node) => {
    if (node.kind === Kind.FIELD) return [node];
    return node.kind === Kind.INLINE_FRAGMENT ? rootFields(node.selectionSet) : [];
  });

const withinLimits = (operation: OperationDefinitionNode): boolean => {
  const roots = rootFields(operation.selectionSet);
  const { depth, fields } = measure(operation.selectionSet, 0);
  return (
    depth <= ROUTER_LIMITS.depth &&
    fields <= ROUTER_LIMITS.totalFields &&
    roots.length <= ROUTER_LIMITS.rootFields &&
    roots.filter((node) => node.alias !== undefined).length <= ROUTER_LIMITS.rootFieldAliases &&
    // Introspection is off on both routers (C-48), so it's no query they'd run.
    roots.every((node) => !node.name.value.startsWith("__"))
  );
};

/** Every string value in the operation, which the user would read in the editor. */
const stringsIn = (document: DocumentNode): string[] => {
  const strings: string[] = [];
  visit(document, { StringValue: (node) => void strings.push(node.value) });
  return strings;
};

/**
 * One query the routers would run, printed afresh, or nothing. It must parse, hold exactly one
 * operation and no fragment definitions, read only (GR-11), stay within the routers' limits and
 * validate against the schema. Its strings must be plain text, and printing it drops any comment,
 * so a valid query can't carry a message to the user. Anything else from a model never reaches
 * the editor (GR-12).
 */
export const createOperationCheck = (schemaSdl: string) => {
  let schema: GraphQLSchema | undefined;
  return (text: string): string | undefined => {
    schema ??= buildSchema(schemaSdl);
    try {
      const document = parse(text, { maxTokens: 2_000 });
      const [operation, ...rest] = document.definitions;
      if (operation?.kind !== Kind.OPERATION_DEFINITION || rest.length > 0) return undefined;
      if (operation.operation !== OperationTypeNode.QUERY) return undefined;
      // The limits first: they're cheap, and validation of an oversized operation isn't.
      const runnable =
        withinLimits(operation) &&
        stringsIn(document).every(isPlainText) &&
        validate(schema, document).length === 0;
      return runnable ? print(document) : undefined;
    } catch {
      return undefined;
    }
  };
};
