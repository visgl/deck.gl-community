// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// @ts-nocheck This modal file should be phased out.

/* eslint-env browser */

import * as React from 'react';

const buttonStyle = {
  display: 'block',
  color: '#fff',
  backgroundColor: 'rgb(90, 98, 94)',
  fontSize: '1em',
  margin: '0.25em',
  padding: '0.375em 0.75em',
  border: '1px solid transparent',
  borderRadius: '0.25em'
};

const backdropStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  overflowX: 'hidden',
  overflowY: 'auto',
  backgroundColor: 'rgba(0, 0, 0, 0.25)'
};

const modalStyle = {
  position: 'relative',
  display: 'block',
  width: '50rem',
  height: 'auto',
  maxWidth: '500px',
  margin: '1.75rem auto',
  boxSizing: 'border-box',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
  fontSize: '1rem',
  fontWeight: 400,
  color: 'rgb(21, 25, 29)',
  lineHeight: 1.5,
  textAlign: 'left'
};

const contentStyle = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  pointerEvents: 'auto',
  backgroundColor: '#fff',
  backgroundClip: 'padding-box',
  border: '1px solid rgba(0, 0, 0, 0.2)',
  borderRadius: '0.3rem',
  outline: 0
};

const headerRowStyle = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '0.75rem 0.75rem',
  borderBottom: '1px solid rgb(222, 226, 230)'
};

const headerStyle = {
  fontSize: '1.25rem',
  fontWeight: 500,
  margin: 0
};

export function Button(props) {
  const {style, ...rest} = props;
  return <button {...rest} style={{...buttonStyle, ...style}} />;
}

export type ModalProps = {
  title: any;
  content: any;
  onClose: () => unknown;
};

export function EditorModal(props: ModalProps) {
  const [isOpen, setIsOpen] = React.useState(true);

  function toggleModal() {
    if (isOpen) {
      props.onClose();
    }
    setIsOpen(!isOpen);
  }

  React.useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        toggleModal();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div style={backdropStyle} onClick={toggleModal}>
      <div style={modalStyle} onClick={event => event.stopPropagation()}>
        <div style={contentStyle}>
          <div style={headerRowStyle}>
            <h5 style={headerStyle}>{props.title}</h5>
          </div>
          {props.content}
        </div>
      </div>
    </div>
  );
}
