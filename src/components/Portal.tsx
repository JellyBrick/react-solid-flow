import { ReactNode, ReactPortal } from "react";
import { createPortal } from "react-dom";

interface PortalProps {
  mount?: Element | DocumentFragment | string;
  // TODO create this for solidJs compatibility?
  // useShadow?: boolean;
  children?: ReactNode;
}

/** Component for rendering children outside of the Component Hierarchy root node. */
export const Portal = ({
  mount,
  ...props
}: PortalProps): ReactPortal | null => {
  const target =
    mount == null ? document.body :
    (mount instanceof Element || mount instanceof DocumentFragment) ? mount :
    document.querySelector(mount);

  if (!target) {
    return null;
  }
  return createPortal(props.children, target);
};