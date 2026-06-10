import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { nodeToElement } from "../helpers/nodeToElement";

interface SwitchProps {
  children: ReactNode;
  /** content to display if no Match predicate is truthy */
  fallback?: ReactNode;
}

type WhenElement = ReactElement<{ when?: unknown }>;

const findFirstMatch = (children: ReactNode): WhenElement | null => {
  if (isValidElement<{ when?: unknown }>(children)) {
    return children.props.when ? children : null;
  }
  if (
    children != null &&
    typeof children === "object" &&
    (Array.isArray(children) || Symbol.iterator in children)
  ) {
    for (const child of children as Iterable<ReactNode>) {
      const found = findFirstMatch(child);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

/** Component to display one exclusive condition out of many,
 * using Match component
 */
export const Switch = (props: SwitchProps): ReactElement | null => {
  return findFirstMatch(props.children) ?? nodeToElement(props.fallback);
};
