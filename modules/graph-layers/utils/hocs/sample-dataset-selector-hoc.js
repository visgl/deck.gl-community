// @noflow
import React from 'react';
import {select} from '@storybook/addon-knobs';
import SAMPLE_GRAPH_DATASETS from '../data/sample-datasets';

import {JSONLoader} from '../../src';

const defaultLoader = data => JSONLoader({json: data});
const SampleDatasetSelectorHOC = (WrappedComponent, loader = defaultLoader) => {
  const hoc = props => {
    const selectedDataset = select(
      'Dataset',
      Object.keys(SAMPLE_GRAPH_DATASETS).reduce((res, k) => {
        res[k] = k;
        return res;
      }, {}),
      'Les Miserable',
      'Dataset'
    );
    const graphData = SAMPLE_GRAPH_DATASETS[selectedDataset]();
    return <WrappedComponent graph={loader(graphData)} {...props} />;
  };
  hoc.displayName = 'SampleDatasetSelectorHOC';
  return hoc;
};

export default SampleDatasetSelectorHOC;
