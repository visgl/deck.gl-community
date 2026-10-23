import * as React from 'react';
import {createPortal} from 'react-dom';
import {CustomPanel, type CustomPanelProps} from '@deck.gl-community/panels';
import {Panel, type PanelProps} from './panel';

/** React-owned content that can participate in any panel composition. */
export type ReactPanelContentProps = Omit<CustomPanelProps, 'id' | 'onRenderHTML' | 'className'> & {
  id?: string;
  children?: React.ReactNode;
};

/** Returns a panel definition and a portal that retains the caller's React context. */
export function useReactPanel({
  id,
  title,
  children,
  theme,
  disabled,
  keepMounted
}: ReactPanelContentProps) {
  const generatedId = React.useId();
  const [element, setElement] = React.useState<HTMLElement | null>(null);
  const onRenderHTML = React.useCallback((root: HTMLElement) => {
    setElement(root);
    return () => setElement(current => (current === root ? null : current));
  }, []);
  const panel = React.useMemo(
    () =>
      new CustomPanel({
        id: id ?? generatedId,
        title,
        theme,
        disabled,
        keepMounted,
        onRenderHTML
      }),
    [id, generatedId, title, theme, disabled, keepMounted, onRenderHTML]
  );
  return {panel, portal: element ? createPortal(children, element) : null};
}

/** Props for directly embedding React children in a themed panel surface. */
export type ReactPanelProps = ReactPanelContentProps & Omit<PanelProps, 'panel'>;

/** Embed React children without creating a separate React root or losing context. */
export function ReactPanel({
  id,
  title,
  children,
  disabled,
  keepMounted,
  ...hostProps
}: ReactPanelProps) {
  const {panel, portal} = useReactPanel({id, title, children, disabled, keepMounted});
  return (
    <>
      <Panel {...hostProps} panel={panel} />
      {portal}
    </>
  );
}
