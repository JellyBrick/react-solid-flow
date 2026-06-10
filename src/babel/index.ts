import type { NodePath, PluginObj, PluginPass } from "@babel/core";
import type * as BabelTypes from "@babel/types";

type Types = typeof BabelTypes;
type AnyPath = NodePath<any>;
type Expr = BabelTypes.Expression;
type FnExpr = BabelTypes.ArrowFunctionExpression | BabelTypes.FunctionExpression;

const PKG = "@jellybrick/react-solid-flow";
const SOURCES = new Set([PKG, "react-solid-flow"]);
const INTERNAL_SOURCE = `${PKG}/internal`;
const TARGETS = new Set(["Show", "Switch", "Match", "Await", "For"]);

interface State extends PluginPass {
  mapArrayId?: BabelTypes.Identifier;
  renderPropId?: BabelTypes.Identifier;
}

/** Thrown to abort a single element transform and leave the runtime call intact. */
const BAIL = Symbol("bail");

export default function reactSolidFlowInline(
  { types: t }: { types: Types },
): PluginObj<State> {
  const isFn = (e: any): e is FnExpr =>
    t.isArrowFunctionExpression(e) || t.isFunctionExpression(e);

  /** How a prop/child value must be handled to match runtime renderProp semantics:
   * literal functions are called, unambiguous static nodes are emitted as-is,
   * anything else needs the runtime typeof check (renderProp helper). */
  const classify = (e: Expr): "fn" | "static" | "dynamic" => {
    if (isFn(e)) return "fn";
    if (
      t.isJSXElement(e) || t.isJSXFragment(e) ||
      t.isStringLiteral(e) || t.isNumericLiteral(e) ||
      t.isBooleanLiteral(e) || t.isNullLiteral(e) ||
      t.isTemplateLiteral(e)
    ) {
      return "static";
    }
    return "dynamic";
  };

  /** Resolve a JSX tag to its canonical react-solid-flow component name, or null. */
  const canonicalName = (path: AnyPath): string | null => {
    const nameNode = path.node.openingElement.name;
    if (t.isJSXIdentifier(nameNode)) {
      const binding = path.scope.getBinding(nameNode.name);
      const bpath = binding?.path;
      if (bpath?.isImportSpecifier()) {
        const decl = bpath.parentPath;
        if (decl?.isImportDeclaration() && SOURCES.has(decl.node.source.value)) {
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
        if (decl?.isImportDeclaration() && SOURCES.has(decl.node.source.value)) {
          return nameNode.property.name;
        }
      }
    }
    return null;
  };

  /** Last matching attribute wins, mirroring React's duplicate-prop semantics. */
  const findAttr = (
    opening: BabelTypes.JSXOpeningElement,
    name: string,
  ): BabelTypes.JSXAttribute | undefined => {
    let found: BabelTypes.JSXAttribute | undefined;
    for (const a of opening.attributes) {
      if (t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name) {
        found = a;
      }
    }
    return found;
  };

  const hasSpread = (opening: BabelTypes.JSXOpeningElement) =>
    opening.attributes.some((a) => t.isJSXSpreadAttribute(a));

  /** Bail if the element carries props we can't safely preserve when unwrapping. */
  const assertSafeOpening = (opening: BabelTypes.JSXOpeningElement) => {
    if (hasSpread(opening)) throw BAIL;
    if (findAttr(opening, "key") || findAttr(opening, "ref")) throw BAIL;
    if (findAttr(opening, "children")) throw BAIL;
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

  /** Detect await/yield belonging to the ENCLOSING function context. Moving such
   * an expression into a generated (non-async) arrow IIFE would be a syntax error. */
  const containsOuterAwait = (node: BabelTypes.Node): boolean => {
    let found = false;
    const walk = (n: any) => {
      if (!n || typeof n.type !== "string" || found) return;
      if (t.isAwaitExpression(n) || t.isYieldExpression(n)) {
        found = true;
        return;
      }
      if (t.isFunction(n)) return; // its own context — safe to move
      for (const key of t.VISITOR_KEYS[n.type] ?? []) {
        const sub = n[key];
        if (Array.isArray(sub)) {
          for (const s of sub) walk(s);
        } else {
          walk(sub);
        }
      }
    };
    walk(node);
    return found;
  };

  const assertMovable = (...nodes: ReadonlyArray<BabelTypes.Node | null>) => {
    for (const n of nodes) {
      if (n && containsOuterAwait(n)) throw BAIL;
    }
  };

  /** Meaningful JSX children, matching the JSX transform's text rules:
   * newline-containing whitespace-only text is dropped, single-line spaces are
   * significant. Spread children can't be represented — bail. */
  const meaningfulChildren = (
    children: readonly BabelTypes.Node[],
  ): BabelTypes.Node[] => {
    const kids: BabelTypes.Node[] = [];
    for (const c of children) {
      if (t.isJSXSpreadChild(c)) throw BAIL;
      if (t.isJSXText(c)) {
        if (c.value.trim() === "" && /[\r\n]/.test(c.value)) continue;
        kids.push(c);
        continue;
      }
      if (t.isJSXExpressionContainer(c) && t.isJSXEmptyExpression(c.expression)) {
        continue;
      }
      kids.push(c);
    }
    return kids;
  };

  /** Build a single expression from meaningful kids (null when there are none).
   * JSXText stays wrapped in a fragment so the JSX transform keeps its exact
   * whitespace semantics. */
  const exprFromKids = (kids: readonly BabelTypes.Node[]): Expr | null => {
    if (kids.length === 0) return null;
    if (kids.length === 1) {
      const c = kids[0];
      if (t.isJSXExpressionContainer(c)) return c.expression as Expr;
      if (t.isJSXElement(c) || t.isJSXFragment(c)) return c;
    }
    return t.jsxFragment(
      t.jsxOpeningFragment(),
      t.jsxClosingFragment(),
      kids as BabelTypes.JSXFragment["children"],
    );
  };

  const ensureHelper = (
    path: AnyPath,
    state: State,
    key: "mapArrayId" | "renderPropId",
    exportName: string,
  ): BabelTypes.Identifier => {
    if (!state[key]) {
      const program = path.scope.getProgramParent().path as NodePath<BabelTypes.Program>;
      const id = program.scope.generateUidIdentifier(exportName);
      program.unshiftContainer(
        "body",
        t.importDeclaration(
          [t.importSpecifier(id, t.identifier(exportName))],
          t.stringLiteral(INTERNAL_SOURCE),
        ),
      );
      state[key] = id;
    }
    return t.cloneNode(state[key]!);
  };

  /** Replace a JSX element with a plain expression, keeping the AST valid when
   * the element sits in JSX-children position. */
  const replaceWithExpr = (path: AnyPath, expr: Expr) => {
    const parent = path.parentPath;
    if (parent && (parent.isJSXElement() || parent.isJSXFragment())) {
      path.replaceWith(t.jsxExpressionContainer(expr));
    } else {
      path.replaceWith(expr);
    }
  };

  /**
   * `when ? <children> : alt`, evaluating `when` once.
   * Literal function children are invoked with the truthy value; values whose
   * function-ness is only known at runtime go through the renderProp helper.
   */
  const conditionalFrom = (
    path: AnyPath,
    state: State,
    whenExpr: Expr,
    children: readonly BabelTypes.Node[],
    alt: Expr,
  ): Expr => {
    const kids = meaningfulChildren(children);
    if (kids.length === 1 && t.isJSXExpressionContainer(kids[0])) {
      const e = (kids[0] as BabelTypes.JSXExpressionContainer).expression as Expr;
      const kind = classify(e);
      if (kind === "fn" || kind === "dynamic") {
        // alt (and a dynamic expr) move into the generated arrow body.
        assertMovable(alt, kind === "dynamic" ? e : null);
        const w = path.scope.generateUidIdentifier("w");
        const value = kind === "fn"
          ? t.callExpression(e as FnExpr, [t.cloneNode(w)])
          : t.callExpression(
            ensureHelper(path, state, "renderPropId", "renderProp"),
            [e, t.cloneNode(w)],
          );
        const body = t.conditionalExpression(t.cloneNode(w), value, alt);
        return t.callExpression(t.arrowFunctionExpression([w], body), [whenExpr]);
      }
    }
    return t.conditionalExpression(whenExpr, exprFromKids(kids) ?? t.nullLiteral(), alt);
  };

  const transformShow = (path: AnyPath, state: State) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const whenExpr = requiredAttrExpr(opening, "when");
    const fallback = optionalAttrExpr(opening, "fallback") ?? t.nullLiteral();
    replaceWithExpr(path, conditionalFrom(path, state, whenExpr, path.node.children, fallback));
  };

  const transformMatch = (path: AnyPath, state: State) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const whenExpr = requiredAttrExpr(opening, "when");
    replaceWithExpr(path, conditionalFrom(path, state, whenExpr, path.node.children, t.nullLiteral()));
  };

  const transformSwitch = (path: AnyPath, state: State) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    let acc: Expr = optionalAttrExpr(opening, "fallback") ?? t.nullLiteral();

    const matches = (path.get("children") as AnyPath[]).filter((cp) => {
      const n = cp.node;
      if (t.isJSXText(n)) {
        return !(n.value.trim() === "" && /[\r\n]/.test(n.value));
      }
      return !(t.isJSXExpressionContainer(n) && t.isJSXEmptyExpression(n.expression));
    });

    for (const cp of matches) {
      if (!cp.isJSXElement() || canonicalName(cp) !== "Match") throw BAIL;
      const co = cp.node.openingElement;
      if (hasSpread(co) || findAttr(co, "key") || findAttr(co, "ref") || findAttr(co, "children")) {
        throw BAIL;
      }
      if (!findAttr(co, "when")) throw BAIL;
    }

    for (let i = matches.length - 1; i >= 0; i--) {
      const cp = matches[i];
      const whenExpr = attrToExpr(findAttr(cp.node.openingElement, "when")!);
      acc = conditionalFrom(cp, state, whenExpr, cp.node.children, acc);
    }
    replaceWithExpr(path, acc);
  };

  const transformAwait = (path: AnyPath, state: State) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const forExpr = requiredAttrExpr(opening, "for");
    const fallback = optionalAttrExpr(opening, "fallback");
    const catchProp = optionalAttrExpr(opening, "catch");
    const childExpr = exprFromKids(meaningfulChildren(path.node.children));

    const r = path.scope.generateUidIdentifier("r");
    const member = (prop: string) => t.memberExpression(t.cloneNode(r), t.identifier(prop));

    // Every branch expression moves into the arrow body (only `for` stays an argument).
    const branch = (e: Expr | null, args: () => Expr[]): Expr => {
      if (!e) return t.nullLiteral();
      assertMovable(e);
      const kind = classify(e);
      if (kind === "fn") {
        return t.callExpression(t.cloneNode(e) as FnExpr, args());
      }
      if (kind === "dynamic") {
        return t.callExpression(
          ensureHelper(path, state, "renderPropId", "renderProp"),
          [t.cloneNode(e), ...args()],
        );
      }
      return t.cloneNode(e);
    };

    const undef = path.scope.buildUndefinedNode();
    const body = t.conditionalExpression(
      t.binaryExpression("==", t.cloneNode(r), t.nullLiteral()),
      t.nullLiteral(),
      t.conditionalExpression(
        member("loading"),
        branch(fallback, () => []),
        t.conditionalExpression(
          t.binaryExpression("!==", member("error"), t.cloneNode(undef)),
          branch(catchProp, () => [member("error")]),
          t.conditionalExpression(
            t.binaryExpression("===", member("data"), t.cloneNode(undef)),
            branch(fallback, () => []),
            branch(childExpr, () => [member("data")]),
          ),
        ),
      ),
    );
    replaceWithExpr(path, t.callExpression(t.arrowFunctionExpression([r], body), [forExpr]));
  };

  const transformFor = (path: AnyPath, state: State) => {
    const opening = path.node.openingElement;
    assertSafeOpening(opening);
    const eachExpr = requiredAttrExpr(opening, "each");
    const fallback = optionalAttrExpr(opening, "fallback");
    const childArg: Expr = exprFromKids(meaningfulChildren(path.node.children)) ?? t.nullLiteral();

    const args: Expr[] = [eachExpr, childArg];
    if (fallback) args.push(fallback);
    replaceWithExpr(path, t.callExpression(ensureHelper(path, state, "mapArrayId", "mapArray"), args));
  };

  return {
    name: "react-solid-flow-inline",
    visitor: {
      JSXElement(path, state) {
        const name = canonicalName(path);
        if (!name || !TARGETS.has(name)) return;

        // A Match anywhere under a react-solid-flow <Switch> belongs to that
        // Switch (or to its runtime fallback) — never transform it standalone.
        if (
          name === "Match" &&
          path.findParent((p) => p.isJSXElement() && canonicalName(p) === "Switch")
        ) {
          return;
        }

        try {
          switch (name) {
            case "Show": transformShow(path, state); break;
            case "Switch": transformSwitch(path, state); break;
            case "Match": transformMatch(path, state); break;
            case "Await": transformAwait(path, state); break;
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
