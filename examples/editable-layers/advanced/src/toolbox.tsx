// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import './toolbox.css';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  PropsWithChildren
} from 'react';

const styles = {
  toolboxItem: {
    flexBasis: '50%'
  }
};

export const Toolbox = (props: HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className="editable-layers-toolbox" />
);

export const ToolboxRow = (props: PropsWithChildren) => <div>{props.children}</div>;
export const ToolboxControl = (props: PropsWithChildren) => (
  <div style={styles.toolboxItem}>{props.children}</div>
);

export const ToolboxTitle = (props: HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className="editable-layers-toolbox-title" />
);

type ToolboxButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {selected?: boolean};

export const ToolboxButton = ({selected, ...props}: ToolboxButtonProps) => (
  <button
    {...props}
    className={`editable-layers-toolbox-button ${
      selected ? 'editable-layers-toolbox-item-selected' : ''
    }`}
  />
);

export const ToolboxCheckbox = (
  props: PropsWithChildren<InputHTMLAttributes<HTMLInputElement>>
) => (
  <label>
    <div className="editable-layers-toolbox-checkbox">
      <input {...{...props, children: null}} />
      {props.children}
    </div>
  </label>
);
