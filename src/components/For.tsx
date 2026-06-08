import React, { Fragment, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { nodeToElement } from "../helpers/nodeToElement";

interface ForProps<T, U extends ReactNode> {
  /** Array to iterate over */
  each: ReadonlyArray<T> | undefined | null;
  /** RenderProp for children generation
   * OR a static element displayed each.length times */
  children: ReactNode | ((item: T, idx: number) => U);
  /** Fallback item, displayed if *each* has zero length, or isn't an array */
  fallback?: ReactNode;
}

/** Component for mapping an array into collection of ReactNode's
 * Omits nullish children and provides keys if they're not specified.
 */
export const For = <T, U extends ReactNode>({
  children,
  each,
  fallback = null,
}: ForProps<T, U>): ReactElement | null => {
  if (!Array.isArray(each) || !each.length || children == null) {
    return nodeToElement(fallback);
  }

  if (typeof children !== "function") {
    return (
      <>{each.map((_, idx) => <Fragment key={idx}>{children}</Fragment>)}</>
    );
  }

  const content: ReactElement[] = new Array(each.length);
  let w = 0;
  for (let i = 0; i < each.length; i++) {
    const child = children(each[i], i);
    if (child == null) {
      continue;
    }
    if (!isValidElement(child) || !child.key) {
      content[w++] = <Fragment key={i}>{child}</Fragment>;
    } else {
      content[w++] = child;
    }
  }
  if (!w) {
    return nodeToElement(fallback);
  }
  content.length = w;

  return <>{content}</>;
};