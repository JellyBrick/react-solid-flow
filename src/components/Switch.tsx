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
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findFirstMatch(child);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (isValidElement<{ when?: unknown }>(children) && children.props.when) {
    return children;
  }
  return null;
};

/** Component to display one exclusive condition out of many,
 * using Match component
 */
export const Switch = (props: SwitchProps): ReactElement | null => {
  return findFirstMatch(props.children) ?? nodeToElement(props.fallback);
};
