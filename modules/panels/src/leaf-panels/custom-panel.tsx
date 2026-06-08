/** @jsxImportSource preact */
import {useLayoutEffect, useRef} from 'preact/hooks';
import {Panel} from '../panels/panel';

import type {PanelTheme} from '../panels/panel';

/** Props for an imperative DOM-backed panel definition. */
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

/** Panel definition that lets callers render custom HTML into a managed host. */
export class CustomPanel extends Panel {
  constructor({
    id,
    title,
    onRenderHTML,
    disabled,
    keepMounted,
    className,
    theme = 'inherit'
  }: CustomPanelProps) {
    super({
      id,
      title,
      theme,
      disabled,
      keepMounted,
      content: <CustomPanelContent className={className} onRenderHTML={onRenderHTML} />
    });
  }
}
