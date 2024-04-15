/* eslint-env browser */
import * as React from 'react';
import {AnyGeoJson} from '@deck.gl-community/editable-layers';
import {EditorModal} from '@deck.gl-community/react';
import {ExportComponent} from './export-component';

export type ExportModalProps = {
  geoJson: AnyGeoJson;
  onClose: () => unknown;
  filename?: string;
  additionalInputs?: React.ReactNode;
};

export function ExportModal(props: ExportModalProps) {
  return (
    <EditorModal
      onClose={props.onClose}
      title={'Export'}
      content={<ExportComponent {...props} />}
    />
  );
}
