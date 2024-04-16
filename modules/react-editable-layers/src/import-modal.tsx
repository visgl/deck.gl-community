/* eslint-env browser */

import * as React from 'react';
import {ImportComponent} from './import-component';
import {Modal} from '@deck.gl-community/react';

export type ImportModalProps = {
  onImport: (arg0: any) => unknown;
  onClose: () => unknown;
  additionalInputs?: React.ReactNode;
};

export function ImportModal(props: ImportModalProps) {
  return (
    <Modal
      onClose={props.onClose}
      title={'Import'}
      content={
        <ImportComponent
          onImport={props.onImport}
          onCancel={props.onClose}
          additionalInputs={props.additionalInputs}
        />
      }
    />
  );
}
