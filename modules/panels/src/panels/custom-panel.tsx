/** @jsxImportSource preact */
import {useLayoutEffect, useRef} from 'preact/hooks';

import type {JSX} from 'preact';
import type {Panel, PanelTheme} from './panel-types';

export type CustomPanelProps = {
  id: string;
  title: string;
  onRenderHTML: (rootElement: HTMLElement) => void | (() => void);
  disabled?: boolean;
  keepMounted?: boolean;
  className?: string;
  theme?: PanelTheme;
};

function CustomPanelContent({
  className,
  onRenderHTML
}: Pick<CustomPanelProps, 'className' | 'onRenderHTML'>) {
  const rootElementRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const rootElement = rootElementRef.current;
    if (!rootElement) {
      return undefined;
    }

    const cleanup = onRenderHTML(rootElement);
    return () => {
      if (typeof cleanup === 'function') {
        cleanup();
      }
    };
  }, [onRenderHTML]);

  return <div ref={rootElementRef} className={className} />;
}

export class CustomPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;
  disabled?: boolean;
  keepMounted?: boolean;

  constructor({
    id,
    title,
    onRenderHTML,
    disabled,
    keepMounted,
    className,
    theme = 'inherit'
  }: CustomPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.disabled = disabled;
    this.keepMounted = keepMounted;
    this.content = <CustomPanelContent className={className} onRenderHTML={onRenderHTML} />;
  }
}
