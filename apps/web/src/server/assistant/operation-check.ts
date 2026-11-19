import {
  buildSchema,
  Kind,
  OperationTypeNode,
  parse,
  validate,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from "graphql";

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

const withinLimits = (operation: OperationDefinitionNode): boolean => {
  const roots = operation.selectionSet.selections.filter((node) => node.kind === Kind.FIELD);
  const { depth, fields } = measure(operation.selectionSet, 0);
  return (
    depth <= ROUTER_LIMITS.depth &&
    fields <= ROUTER_LIMITS.totalFields &&
    roots.length <= ROUTER_LIMITS.rootFields &&
    roots.filter((node) => node.alias !== undefined).length <= ROUTER_LIMITS.rootFieldAliases
  );
};

/**
 * Whether text is one query the routers would run: it parses, holds exactly one operation and no
 * fragment definitions, reads only (GR-11), validates against the schema, and stays within the
 * routers' limits. Anything else from a model never reaches the editor (GR-12).
 */
export const createOperationCheck = (schemaSdl: string) => {
  let schema: GraphQLSchema | undefined;
  return (text: string): boolean => {
    schema ??= buildSchema(schemaSdl);
    try {
      const document = parse(text, { maxTokens: 2_000 });
      const [operation, ...rest] = document.definitions;
      if (operation?.kind !== Kind.OPERATION_DEFINITION || rest.length > 0) return false;
      if (operation.operation !== OperationTypeNode.QUERY) return false;
      return validate(schema, document).length === 0 && withinLimits(operation);
    } catch {
      return false;
    }
  };
};
