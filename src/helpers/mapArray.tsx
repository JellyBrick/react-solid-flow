import React, { Fragment, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { nodeToElement } from "./nodeToElement";

export const mapArray = <T, U extends ReactNode>(
  each: ReadonlyArray<T> | undefined | null,
  children: ReactNode | ((item: T, idx: number) => U),
  fallback: ReactNode = null,
): ReactElement | null => {
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
