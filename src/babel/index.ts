import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import type * as BabelTypes from "@babel/types";

type Types = typeof BabelTypes;
type AnyPath = NodePath<any>;
type Expr = BabelTypes.Expression;

const SOURCE = "react-solid-flow";
const INTERNAL_SOURCE = "react-solid-flow/internal";
const TARGETS = new Set(["Show", "Switch", "Match", "Await", "For"]);

interface State extends PluginPass {
  mapArrayId?: BabelTypes.Identifier;
}

/** Thrown to abort a single element transform and leave the runtime call intact. */
const BAIL = Symbol("bail");

export default function reactSolidFlowInline(
  { types: t }: { types: Types },
): PluginObj<State> {
  const isFn = (e: any): e is BabelTypes.ArrowFunctionExpression | BabelTypes.FunctionExpression =>
    t.isArrowFunctionExpression(e) || t.isFunctionExpression(e);

  /** Resolve a JSX tag to its canonical react-solid-flow component name, or null. */
  const canonicalName = (path: AnyPath): string | null => {
    const nameNode = path.node.openingElement.name;
    if (t.isJSXIdentifier(nameNode)) {
      const binding = path.scope.getBinding(nameNode.name);
      const bpath = binding?.path;
      if (bpath?.isImportSpecifier()) {
        const decl = bpath.parentPath;
        if (decl?.isImportDeclaration() && decl.node.source.value === SOURCE) {
          const imported = bpath.node.imported;
          return t.isIdentifier(imported) ? imported.name : imported.value;
        }
      }
      return null;
    }
    if (
      t.isJSXMemberExpression(nameNode) &&
      t.isJSXIdentifier(nameNode.object) &&
      t.isJSXIdentifier(nameNode.property)
    ) {
      const binding = path.scope.getBinding(nameNode.object.name);
      const bpath = binding?.path;
      if (bpath?.isImportNamespaceSpecifier()) {
        const decl = bpath.parentPath;
        if (decl?.isImportDeclaration() && decl.node.source.value === SOURCE) {
          return nameNode.property.name;
        }
      }
    }
    return null;
  };

  const findAttr = (
    opening: BabelTypes.JSXOpeningElement,
    name: string,
  ): BabelTypes.JSXAttribute | undefined =>
    opening.attributes.find(
      (a): a is BabelTypes.JSXAttribute =>
        t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name,
    );

  const hasSpread = (opening: BabelTypes.JSXOpeningElement) =>
    opening.attributes.some((a) => t.isJSXSpreadAttribute(a));

  /** Bail if the element carries props we can't safely preserve when unwrapping. */
  const assertSafeOpening = (opening: BabelTypes.JSXOpeningElement) => {
    if (hasSpread(opening)) throw BAIL;
    if (findAttr(opening, "key") || findAttr(opening, "ref")) throw BAIL;
  };

  /** Convert a JSX attribute to its value expression (throws BAIL if not analyzable). */
  const attrToExpr = (attr: BabelTypes.JSXAttribute): Expr => {
    const v = attr.value;
    if (v == null) return t.booleanLiteral(true); // shorthand `<Show when>`
    if (t.isStringLiteral(v)) return v;
    if (t.isJSXExpressionContainer(v)) {
      if (t.isJSXEmptyExpression(v.expression)) throw BAIL;
      return v.expression;
    }
    throw BAIL;
  };

  const requiredAttrExpr = (opening: BabelTypes.JSXOpeningElement, name: string): Expr => {
    const attr = findAttr(opening, name);
    if (!attr) throw BAIL;
    return attrToExpr(attr);
  };

  const optionalAttrExpr = (
    opening: BabelTypes.JSXOpeningElement,
    name: string,
  ): Expr | null => {
    const attr = findAttr(opening, name);
    return attr ? attrToExpr(attr) : null;
  };

  /** Meaningful JSX children: drop whitespace-only text and comment containers. */
  const meaningfulChildren = (
    children: readonly BabelTypes.Node[],
  ): BabelTypes.Node[] =>
    children.filter((c) => {
      if (t.isJSXText(c)) return c.value.trim() !== "";
      return !(t.isJSXExpressionContainer(c) && t.isJSXEmptyExpression(c.expression));

    });

  /** Build a single expression from JSX children (null when there are none). */
  const childrenExpr = (children: readonly BabelTypes.Node[]): Expr | null => {
    const kids = meaningfulChildren(children);
    if (kids.length === 0) return null;
    if (kids.length === 1) {
      const c = kids[0];
      if (t.isJSXExpressionContainer(c)) return c.expression as Expr;
      if (t.isJSXText(c)) return t.stringLiteral(c.value.trim());
      return c as Expr; // JSXElement | JSXFragment are Expressions
    }
    return t.jsxFragment(
      t.jsxOpeningFragment(),
      t.jsxClosingFragment(),
      kids as BabelTypes.JSXFragment["children"],
    );
  };

  /** Single render-prop function child, if present. */
  const functionChild = (
    children: readonly BabelTypes.Node[],
  ): BabelTypes.ArrowFunctionExpression | BabelTypes.FunctionExpression | null => {
    const kids = meaningfulChildren(children);
    if (kids.length === 1 && t.isJSXExpressionContainer(kids[0])) {
      const e = (kids[0] as BabelTypes.JSXExpressionContainer).expression;
      if (isFn(e)) return e;
    }
    return null;
  };

  /**
   * `when ? <children> : alt`, evaluating `when` once.
   * Function children are invoked with the truthy value via an IIFE.
   */
  const conditionalFrom = (
    path: AnyPath,
    whenExpr: Expr,
    children: readonly BabelTypes.Node[],
    alt: Expr,
  ): Expr => {
    const fn = functionChild(children);
    if (fn) {
      const w = path.scope.generateUidIdentifier("w");
      const body = t.conditionalExpression(
        t.cloneNode(w),
        t.callExpression(fn, [t.cloneNode(w)]),
        alt,
      );
      return t.callExpression(t.arrowFunctionExpression([w], body), [whenExpr]);
    }
    return t.conditionalExpression(whenExpr, childrenExpr(children) ?? t.nullLiteral(), alt);
  };

  const transformShow = (path: AnyPath) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const whenExpr = requiredAttrExpr(opening, "when");
    const fallback = optionalAttrExpr(opening, "fallback") ?? t.nullLiteral();
    path.replaceWith(conditionalFrom(path, whenExpr, path.node.children, fallback));
  };

  const transformMatch = (path: AnyPath) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const whenExpr = requiredAttrExpr(opening, "when");
    path.replaceWith(conditionalFrom(path, whenExpr, path.node.children, t.nullLiteral()));
  };

  const transformSwitch = (path: AnyPath) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    let acc: Expr = optionalAttrExpr(opening, "fallback") ?? t.nullLiteral();

    const matches = (path.get("children") as AnyPath[]).filter((cp) => {
      const n = cp.node;
      if (t.isJSXText(n)) return n.value.trim() !== "";
      return !(t.isJSXExpressionContainer(n) && t.isJSXEmptyExpression(n.expression));

    });

    for (const cp of matches) {
      if (!cp.isJSXElement() || canonicalName(cp) !== "Match") throw BAIL;
      const co = cp.node.openingElement;
      if (hasSpread(co) || findAttr(co, "key") || findAttr(co, "ref")) throw BAIL;
      if (!findAttr(co, "when")) throw BAIL;
    }

    for (let i = matches.length - 1; i >= 0; i--) {
      const cp = matches[i];
      const whenExpr = attrToExpr(findAttr(cp.node.openingElement, "when")!);
      acc = conditionalFrom(cp, whenExpr, cp.node.children, acc);
    }
    path.replaceWith(acc);
  };

  const transformAwait = (path: AnyPath) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const forExpr = requiredAttrExpr(opening, "for");
    const fallback = optionalAttrExpr(opening, "fallback");
    const catchProp = optionalAttrExpr(opening, "catch");
    const childFn = functionChild(path.node.children);
    const staticChild = childFn ? null : childrenExpr(path.node.children);

    const r = path.scope.generateUidIdentifier("r");
    const member = (prop: string) => t.memberExpression(t.cloneNode(r), t.identifier(prop));

    const fallbackBranch = (): Expr => {
      if (!fallback) return t.nullLiteral();
      return isFn(fallback)
        ? t.callExpression(t.cloneNode(fallback), [])
        : t.cloneNode(fallback);
    };
    const catchBranch = (): Expr => {
      if (!catchProp) return t.nullLiteral();
      return isFn(catchProp)
        ? t.callExpression(t.cloneNode(catchProp), [member("error")])
        : t.cloneNode(catchProp);
    };
    const dataBranch = (): Expr => {
      if (childFn) return t.callExpression(childFn, [member("data")]);
      return staticChild ?? t.nullLiteral();
    };

    const undef = path.scope.buildUndefinedNode();
    const body = t.conditionalExpression(
      t.binaryExpression("==", t.cloneNode(r), t.nullLiteral()),
      t.nullLiteral(),
      t.conditionalExpression(
        member("loading"),
        fallbackBranch(),
        t.conditionalExpression(
          t.binaryExpression("!==", member("error"), t.cloneNode(undef)),
          catchBranch(),
          t.conditionalExpression(
            t.binaryExpression("===", member("data"), t.cloneNode(undef)),
            fallbackBranch(),
            dataBranch(),
          ),
        ),
      ),
    );
    path.replaceWith(t.callExpression(t.arrowFunctionExpression([r], body), [forExpr]));
  };

  const mapArrayId = (path: AnyPath, state: State): BabelTypes.Identifier => {
    if (!state.mapArrayId) {
      const program = path.scope.getProgramParent().path as NodePath<BabelTypes.Program>;
      const id = program.scope.generateUidIdentifier("mapArray");
      program.unshiftContainer(
        "body",
        t.importDeclaration(
          [t.importSpecifier(id, t.identifier("mapArray"))],
          t.stringLiteral(INTERNAL_SOURCE),
        ),
      );
      state.mapArrayId = id;
    }
    return t.cloneNode(state.mapArrayId);
  };

  const transformFor = (path: AnyPath, state: State) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const eachExpr = requiredAttrExpr(opening, "each");
    const fallback = optionalAttrExpr(opening, "fallback");
    const childFn = functionChild(path.node.children);
    const childArg: Expr = childFn ?? childrenExpr(path.node.children) ?? t.nullLiteral();

    const args: Expr[] = [eachExpr, childArg];
    if (fallback) args.push(fallback);
    path.replaceWith(t.callExpression(mapArrayId(path, state), args));
  };

  return {
    name: "react-solid-flow-inline",
    visitor: {
      JSXElement(path, state) {
        const name = canonicalName(path);
        if (!name || !TARGETS.has(name)) return;

        if (
          name === "Match" &&
          path.findParent((p) => p.isJSXElement() && canonicalName(p) === "Switch")
        ) {
          return;
        }

        try {
          switch (name) {
            case "Show": transformShow(path); break;
            case "Switch": transformSwitch(path); break;
            case "Match": transformMatch(path); break;
            case "Await": transformAwait(path); break;
            case "For": transformFor(path, state); break;
          }
        } catch (e) {
          if (e === BAIL) return; // leave the original runtime call intact
          throw e;
        }
      },
    },
  };
}
