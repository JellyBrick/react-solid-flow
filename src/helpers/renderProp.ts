import type { ReactElement, ReactNode } from "react";
import { nodeToElement } from "./nodeToElement";

export const renderProp = <TArgs extends ReadonlyArray<unknown>>(
  prop: ((...args: TArgs) => ReactNode) | ReactNode,
  ...args: TArgs
): ReactElement | null => {
  if (typeof prop === "function") {
    return nodeToElement(prop(...args));
  }
  return nodeToElement(prop);
};