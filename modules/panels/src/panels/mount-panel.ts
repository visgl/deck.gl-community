import {h, render} from 'preact';
import {PanelThemeScope} from './panel-theme-scope';
import type {Panel} from './panel';

/** Options for content embedded in an application-owned element. */
export type PanelMountOptions = {
  /** Render the panel title above its body. Defaults to false. */
  showTitle?: boolean;
};

/** One embedded panel surface, independent of floating or docked chrome. */
export type PanelMount = {
  /** Replace or refresh content. Matching ids preserve component state. Null clears it. */
  setPanel: (panel: Panel | null) => void;
  /** Unmount content and remove only the element owned by this mount. Idempotent. */
  finalize: () => void;
};

/** Mount panel content directly, inheriting the application's panel theme. */
export function mountPanel(
  panel: Panel | null,
  parentElement: HTMLElement,
  {showTitle = false}: PanelMountOptions = {}
): PanelMount {
  const root = parentElement.ownerDocument.createElement('div');
  root.dataset.panelHost = '';
  root.style.minWidth = '0';
  parentElement.append(root);
  let finalized = false;
  const setPanel = (nextPanel: Panel | null) => {
    if (finalized) return;
    render(
      nextPanel
        ? h(PanelThemeScope, {panel: nextPanel, key: nextPanel.id}, [
            h('section', {style: {display: 'flex', flexDirection: 'column', gap: '8px'}}, [
              showTitle && nextPanel.title
                ? h(
                    'header',
                    {
                      style: {
                        fontSize: '12px',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        color: 'var(--button-text, rgb(24, 24, 26))'
                      }
                    },
                    nextPanel.title
                  )
                : null,
              h(
                'div',
                {style: {display: 'flex', flexDirection: 'column', gap: '8px'}},
                nextPanel.content
              )
            ])
          ])
        : null,
      root
    );
  };
  setPanel(panel);
  return {
    setPanel,
    finalize: () => {
      if (finalized) return;
      finalized = true;
      render(null, root);
      root.remove();
    }
  };
}
