/**
 * Catches what the lazy 3D subtree can throw — a chunk that fails to load, a
 * shader that does not compile, a solver error on an unexpected build — and
 * hands control back to the viewer, which keeps showing the interactive SVG.
 */
"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onError(error: Error): void;
}

interface State {
  failed: boolean;
}

export class SceneErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void info;
    this.props.onError(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
