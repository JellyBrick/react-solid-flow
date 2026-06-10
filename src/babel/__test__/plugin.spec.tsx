import * as React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { transformSync } from "@babel/core";
import { render, cleanup } from "@testing-library/react";

import plugin from "../index";
import { Show, Switch, Match, Await, For } from "../../lib";
import { mapArray, renderProp } from "../../internal";

afterEach(() => cleanup());

/** Transform keeping JSX in the output (for structural assertions). */
const toCode = (src: string, withPlugin = true): string =>
  transformSync(src, {
    filename: "test.tsx",
    plugins: withPlugin ? [plugin] : [],
    parserOpts: { plugins: ["jsx"] },
    babelrc: false,
    configFile: false,
  })!.code!;

/** Transform to runnable CommonJS (JSX -> createElement, imports -> require). */
const toModule = (src: string, withPlugin: boolean): string =>
  transformSync(src, {
    filename: "test.tsx",
    presets: [["@babel/preset-react", { runtime: "classic" }]],
    plugins: [
      ...(withPlugin ? [plugin] : []),
      "@babel/plugin-transform-modules-commonjs",
    ],
    parserOpts: { plugins: ["jsx"] },
    babelrc: false,
    configFile: false,
  })!.code!;

const requireShim = (id: string): unknown => {
  switch (id) {
    case "react": return React;
    case "react-solid-flow":
    case "@jellybrick/react-solid-flow":
      return { Show, Switch, Match, Await, For };
    case "react-solid-flow/internal":
    case "@jellybrick/react-solid-flow/internal":
      return { mapArray, renderProp };
    default: throw new Error(`Unexpected require: ${id}`);
  }
};

const evalModule = (code: string): { App: React.ComponentType<any> } => {
  const module = { exports: {} as { App: React.ComponentType<any> } };
  new Function("require", "module", "exports", code)(
    requireShim, module, module.exports,
  );
  return module.exports;
};

const domOf = (src: string, withPlugin: boolean, props: object = {}): string => {
  const { App } = evalModule(toModule(src, withPlugin));
  const { container } = render(React.createElement(App, props));
  const html = container.innerHTML;
  cleanup();
  return html;
};

/** With and without the plugin must produce identical DOM. */
const expectEquivalent = (src: string, props: object = {}) =>
  expect(domOf(src, true, props)).toBe(domOf(src, false, props));

describe("react-solid-flow babel plugin", () => {
  describe("structural transform", () => {
    it("inlines Show to a ternary", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show when={value}><Test /></Show>;
      `);
      expect(out).not.toContain("<Show");
      expect(out).toMatch(/value \?\s*<Test\s*\/>\s*:\s*null/);
    });

    it("transforms tags imported from the unscoped package name too", () => {
      const out = toCode(`
        import { Show } from "react-solid-flow";
        const x = <Show when={value}><Test /></Show>;
      `);
      expect(out).not.toContain("<Show");
    });

    it("uses the fallback as the ternary alternate", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show when={value} fallback={<Fb />}><Test /></Show>;
      `);
      expect(out).toMatch(/value \?\s*<Test\s*\/>\s*:\s*<Fb\s*\/>/);
    });

    it("inlines Show render-prop children via an IIFE", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show when={user}>{(u) => <Profile user={u} />}</Show>;
      `);
      expect(out).not.toContain("<Show");
      expect(out).toMatch(/_w\d* =>/);
    });

    it("wraps the replacement in a JSX expression container inside JSX children", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <div><Show when={v}><A /></Show></div>;
      `);
      expect(out).not.toContain("<Show");
      expect(out).toMatch(/<div>\{v \?/);
    });

    it("routes non-literal render-prop children through the renderProp helper", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show when={v}>{renderFn}</Show>;
      `);
      expect(out).not.toContain("<Show");
      expect(out).toContain("@jellybrick/react-solid-flow/internal");
      expect(out).toMatch(/_renderProp\d*\(renderFn,/);
    });

    it("inlines Switch/Match to a ternary chain", () => {
      const out = toCode(`
        import { Switch, Match } from "@jellybrick/react-solid-flow";
        const x = (
          <Switch fallback={<D />}>
            <Match when={a}><A /></Match>
            <Match when={b}><B /></Match>
          </Switch>
        );
      `);
      expect(out).not.toContain("<Switch");
      expect(out).not.toContain("<Match");
      expect(out).toMatch(/a \?\s*<A\s*\/>\s*:\s*b \?\s*<B\s*\/>\s*:\s*<D\s*\/>/);
    });

    it("inlines a standalone Match", () => {
      const out = toCode(`
        import { Match } from "@jellybrick/react-solid-flow";
        const x = <Match when={w}><X /></Match>;
      `);
      expect(out).not.toContain("<Match");
      expect(out).toMatch(/w \?\s*<X\s*\/>\s*:\s*null/);
    });

    it("inlines Await into a state-machine IIFE", () => {
      const out = toCode(`
        import { Await } from "@jellybrick/react-solid-flow";
        const x = <Await for={res} fallback={<L />} catch={<E />}>{(d) => <V data={d} />}</Await>;
      `);
      expect(out).not.toContain("<Await");
      expect(out).toContain(".loading");
      expect(out).toContain(".error");
      expect(out).toContain(".data");
    });

    it("routes non-literal Await props through the renderProp helper", () => {
      const out = toCode(`
        import { Await } from "@jellybrick/react-solid-flow";
        const x = <Await for={r} fallback={spinnerFn} catch={errFn}>{fmtFn}</Await>;
      `);
      expect(out).not.toContain("<Await");
      expect(out).toMatch(/_renderProp\d*\(spinnerFn\)/);
      expect(out).toMatch(/_renderProp\d*\(errFn, _r\d*\.error\)/);
      expect(out).toMatch(/_renderProp\d*\(fmtFn, _r\d*\.data\)/);
    });

    it("lowers For to a mapArray call with injected import", () => {
      const out = toCode(`
        import { For } from "@jellybrick/react-solid-flow";
        const x = <For each={items} fallback={<E />}>{(it) => <Row it={it} />}</For>;
      `);
      expect(out).not.toContain("<For");
      expect(out).toContain("@jellybrick/react-solid-flow/internal");
      expect(out).toMatch(/_mapArray\d*\(items,/);
    });

    it("honors React's last-duplicate-prop-wins semantics", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show when={a} when={b}><A /></Show>;
      `);
      expect(out).toMatch(/b \?\s*<A\s*\/>/);
    });
  });

  describe("bail-out (left as runtime call)", () => {
    it("bails on spread props", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show {...p}><Test /></Show>;
      `);
      expect(out).toContain("<Show");
    });

    it("bails on spread children instead of crashing", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show when={v}>{...items}</Show>;
      `);
      expect(out).toContain("<Show");
    });

    it("bails on a children attribute", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        const x = <Show when={v} children={<A />} />;
      `);
      expect(out).toContain("<Show");
    });

    it("bails on dynamic Switch children", () => {
      const out = toCode(`
        import { Switch, Match } from "@jellybrick/react-solid-flow";
        const x = <Switch>{cond && <Match when={a}><A /></Match>}</Switch>;
      `);
      expect(out).toContain("<Switch");
      expect(out).toContain("<Match");
    });

    it("bails when an outer-context await would move into a generated arrow", () => {
      const out = toCode(`
        import { Show } from "@jellybrick/react-solid-flow";
        async function App() {
          return <Show when={v} fallback={await loadFb()}>{(x) => <A x={x} />}</Show>;
        }
      `);
      expect(out).toContain("<Show");
    });

    it("does not touch a Show not imported from react-solid-flow", () => {
      const out = toCode(`
        import { Show } from "some-other-lib";
        const x = <Show when={v}><Test /></Show>;
      `);
      expect(out).toContain("<Show");
    });

    it("does not touch a locally-defined Show", () => {
      const out = toCode(`
        const Show = (p) => p.children;
        const x = <Show when={v}><Test /></Show>;
      `);
      expect(out).toContain("<Show");
    });
  });

  describe("behavioral equivalence (plugin vs runtime)", () => {
    it("Show — truthy and falsy", () => {
      const src = `
        import * as React from "react";
        import { Show } from "@jellybrick/react-solid-flow";
        export const App = ({ value }) => <Show when={value} fallback={<i>fb</i>}><b>hi</b></Show>;
      `;
      expectEquivalent(src, { value: true });
      expectEquivalent(src, { value: false });
      expectEquivalent(src, { value: 0 });
    });

    it("Show — render-prop children", () => {
      const src = `
        import * as React from "react";
        import { Show } from "@jellybrick/react-solid-flow";
        export const App = ({ user }) => <Show when={user}>{(u) => <span>{u.name}</span>}</Show>;
      `;
      expectEquivalent(src, { user: { name: "mom" } });
      expectEquivalent(src, { user: null });
    });

    it("Show — function passed by reference is invoked, not rendered", () => {
      const src = `
        import * as React from "react";
        import { Show } from "@jellybrick/react-solid-flow";
        export const App = ({ user, renderFn }) => <Show when={user}>{renderFn}</Show>;
      `;
      const renderFn = (u: { name: string }) => React.createElement("span", null, u.name);
      expectEquivalent(src, { user: { name: "mom" }, renderFn });
      expectEquivalent(src, { user: null, renderFn });
    });

    it("Show — nested inside other JSX", () => {
      const src = `
        import * as React from "react";
        import { Show } from "@jellybrick/react-solid-flow";
        export const App = ({ value }) => <div><Show when={value}><b>hi</b></Show></div>;
      `;
      expectEquivalent(src, { value: true });
      expectEquivalent(src, { value: false });
    });

    it("Show — single-line text children keep their whitespace", () => {
      const src = `
        import * as React from "react";
        import { Show } from "@jellybrick/react-solid-flow";
        export const App = ({ value }) => <b><Show when={value}> hello </Show></b>;
      `;
      expectEquivalent(src, { value: true });
    });

    it("Switch/Match — each branch and fallback", () => {
      const src = `
        import * as React from "react";
        import { Switch, Match } from "@jellybrick/react-solid-flow";
        export const App = ({ s }) => (
          <Switch fallback={<i>none</i>}>
            <Match when={s === "a"}><b>A</b></Match>
            <Match when={s === "b"}><b>B</b></Match>
          </Switch>
        );
      `;
      expectEquivalent(src, { s: "a" });
      expectEquivalent(src, { s: "b" });
      expectEquivalent(src, { s: "z" });
    });

    it("Await — pending / errored / ready / unresolved", () => {
      const src = `
        import * as React from "react";
        import { Await } from "@jellybrick/react-solid-flow";
        export const App = ({ r }) => (
          <Await for={r} fallback={<i>loading</i>} catch={(e) => <i>{String(e)}</i>}>
            {(d) => <b>{String(d)}</b>}
          </Await>
        );
      `;
      expectEquivalent(src, { r: { loading: true, data: undefined, error: undefined } });
      expectEquivalent(src, { r: { loading: false, data: undefined, error: "boom" } });
      expectEquivalent(src, { r: { loading: false, data: 42, error: undefined } });
      expectEquivalent(src, { r: { loading: false, data: undefined, error: undefined } });
    });

    it("Await — function props passed by reference", () => {
      const src = `
        import * as React from "react";
        import { Await } from "@jellybrick/react-solid-flow";
        export const App = ({ r, spinnerFn, errFn, fmtFn }) => (
          <Await for={r} fallback={spinnerFn} catch={errFn}>{fmtFn}</Await>
        );
      `;
      const fns = {
        spinnerFn: () => React.createElement("i", null, "spin"),
        errFn: (e: unknown) => React.createElement("i", null, String(e)),
        fmtFn: (d: unknown) => React.createElement("b", null, String(d)),
      };
      expectEquivalent(src, { r: { loading: true, data: undefined, error: undefined }, ...fns });
      expectEquivalent(src, { r: { loading: false, data: undefined, error: "boom" }, ...fns });
      expectEquivalent(src, { r: { loading: false, data: 42, error: undefined }, ...fns });
    });

    it("For — items, keyed items, and empty fallback", () => {
      const src = `
        import * as React from "react";
        import { For } from "@jellybrick/react-solid-flow";
        export const App = ({ items }) => (
          <For each={items} fallback={<i>empty</i>}>{(it) => <li key={it}>{it}</li>}</For>
        );
      `;
      expectEquivalent(src, { items: ["a", "b", "c"] });
      expectEquivalent(src, { items: [] });
      expectEquivalent(src, { items: null });
    });

    it("For — static (non-function) children", () => {
      const src = `
        import * as React from "react";
        import { For } from "@jellybrick/react-solid-flow";
        export const App = ({ items }) => (
          <For each={items}><li>x</li></For>
        );
      `;
      expectEquivalent(src, { items: [1, 2, 3] });
      expectEquivalent(src, { items: [] });
    });
  });

  describe("laziness (intended delta vs eager runtime)", () => {
    it("does not evaluate a hidden branch's expressions after inlining", () => {
      const src = `
        import * as React from "react";
        import { Show } from "@jellybrick/react-solid-flow";
        const Test = () => null;
        export const App = ({ value, track }) => <Show when={value}><Test x={track()} /></Show>;
      `;
      const inlineSpy = vi.fn();
      domOf(src, true, { value: false, track: inlineSpy });
      expect(inlineSpy).not.toHaveBeenCalled();

      const runtimeSpy = vi.fn();
      domOf(src, false, { value: false, track: runtimeSpy });
      expect(runtimeSpy).toHaveBeenCalledTimes(1);
    });
  });
});
