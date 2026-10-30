import type { Root } from "mdast";

type EstreeNode = {
  type: string;
  [key: string]: unknown;
};

type MdxNode = {
  type?: string;
  name?: string | null;
  children?: MdxNode[];
  attributes?: MdxNode[];
  value?: unknown;
  data?: {
    estree?: EstreeNode;
  };
};

const expressionNodeTypes = new Set([
  "mdxFlowExpression",
  "mdxTextExpression",
  "mdxJsxExpressionAttribute",
  "mdxJsxAttributeValueExpression",
]);

const jsxElementNodeTypes = new Set(["mdxJsxFlowElement", "mdxJsxTextElement"]);

const executableElementNames = new Set([
  "base",
  "embed",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
]);

const executableAttributeNames = new Set([
  "dangerouslysetinnerhtml",
  "formaction",
  "srcdoc",
]);

const urlAttributeNames = new Set(["action", "formaction", "href", "src"]);

function assertSafeJsxAttribute(node: MdxNode): void {
  if (node.type !== "mdxJsxAttribute" || typeof node.name !== "string") {
    return;
  }

  const name = node.name.toLowerCase();
  if (name.startsWith("on") || executableAttributeNames.has(name)) {
    throw new Error(`MDX attribute "${node.name}" is not allowed`);
  }

  if (
    urlAttributeNames.has(name) &&
    typeof node.value === "string" &&
    /^\s*(?:data\s*:\s*text\/html|javascript\s*:|vbscript\s*:)/i.test(
      node.value,
    )
  ) {
    throw new Error(`MDX URL attribute "${node.name}" is not allowed`);
  }
}

function isNode(value: unknown): value is EstreeNode {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof value.type === "string",
  );
}

function isStaticProperty(node: EstreeNode): boolean {
  if (
    node.type !== "Property" ||
    node.kind !== "init" ||
    node.method === true ||
    node.computed === true ||
    node.shorthand === true ||
    !isNode(node.value)
  ) {
    return false;
  }

  return isStaticExpression(node.value);
}

function isStaticExpression(node: EstreeNode): boolean {
  switch (node.type) {
    case "Literal":
      return !node.regex;
    case "TemplateLiteral":
      return Array.isArray(node.expressions) && node.expressions.length === 0;
    case "ArrayExpression":
      return (
        Array.isArray(node.elements) &&
        node.elements.every(
          (element) =>
            element === null ||
            (isNode(element) && isStaticExpression(element)),
        )
      );
    case "ObjectExpression":
      return (
        Array.isArray(node.properties) &&
        node.properties.every(
          (property) => isNode(property) && isStaticProperty(property),
        )
      );
    case "UnaryExpression":
      return (
        (node.operator === "+" || node.operator === "-") &&
        isNode(node.argument) &&
        node.argument.type === "Literal" &&
        typeof node.argument.value === "number"
      );
    default:
      return false;
  }
}

function expressionFromProgram(program: EstreeNode): EstreeNode | undefined {
  if (program.type !== "Program" || !Array.isArray(program.body)) return;
  if (program.body.length !== 1 || !isNode(program.body[0])) return;

  const statement = program.body[0];
  if (
    statement.type !== "ExpressionStatement" ||
    !isNode(statement.expression)
  ) {
    return;
  }

  return statement.expression;
}

function assertStaticExpressions(node: MdxNode): void {
  if (
    node.type &&
    jsxElementNodeTypes.has(node.type) &&
    node.name &&
    executableElementNames.has(node.name.toLowerCase())
  ) {
    throw new Error(`MDX element "${node.name}" is not allowed`);
  }

  assertSafeJsxAttribute(node);

  if (node.type && expressionNodeTypes.has(node.type)) {
    const program = node.data?.estree;
    const expression = program && expressionFromProgram(program);
    if (!expression || !isStaticExpression(expression)) {
      throw new Error(
        "MDX JavaScript expressions must contain only static literal values",
      );
    }
  }

  const expressionValue = isNode(node.value) ? [node.value as MdxNode] : [];
  for (const child of [
    ...(node.children ?? []),
    ...(node.attributes ?? []),
    ...expressionValue,
  ]) {
    assertStaticExpressions(child);
  }
}

/**
 * Reject executable MDX expressions before the compiler creates a function.
 *
 * Static literal attributes remain useful for component props such as Mermaid
 * source, inline style objects, and numeric dimensions. Identifiers, property
 * access, calls, interpolation, functions, and spreads are all rejected.
 * Active HTML elements, event handlers, HTML injection, and executable URL
 * schemes are rejected as well.
 */
export function remarkRestrictMdxExpressions() {
  return (tree: Root) => {
    assertStaticExpressions(tree as MdxNode);
  };
}
