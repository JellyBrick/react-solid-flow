import { Component } from "react";
import type { ReactNode } from "react";

interface ErrorBoundaryProps {
  /** renderProp (or static content) to display if error has occured */
  fallback?: ReactNode | ((err: unknown, reset: () => void) => ReactNode);
  /** content to display when no error was catched */
  children?: ReactNode;
  /** callback to call, when an error happens */
  onCatch?: (error: unknown, errorInfo: unknown) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

/** General ErrorBoundary component */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.resetError = this.resetError.bind(this);
  }

  state: ErrorBoundaryState = {
    hasError: false,
    error: undefined,
  };

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: unknown) {
    this.props.onCatch?.(error, errorInfo);
  }

  resetError() {
    this.setState({ hasError: false, error: undefined });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    if (typeof this.props.fallback === "function") {
      return this.props.fallback(this.state.error, this.resetError);
    }
    return this.props.fallback;
  }
}
