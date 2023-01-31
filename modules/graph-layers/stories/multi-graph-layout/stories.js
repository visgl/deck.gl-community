import React from 'react';
import {storiesOf} from '@storybook/react';
import {boolean, color, number} from '@storybook/addon-knobs';

const stories = storiesOf('Experimental Layouts', module);

// start to add examples
import BasicDoc from './README.md';
import MultiGraphExample from './app';

const groupNodeCustomization = 'Node Customization';
const groupEdgeCustomization = 'Edge Customization';

const fontSizeOption = {
  range: true,
  min: 2,
  max: 36,
};

const widthOption = {
  range: true,
  min: 1,
  max: 12,
};

stories.add(
  'MultiGraph',
  () => (
    <MultiGraphExample
      showNodeCircle={boolean('Show Node Circle', true, groupNodeCustomization)}
      showNodePlaceholder={boolean(
        'Show Node Placeholder',
        true,
        groupNodeCustomization
      )}
      showNodeLabel={boolean('Show Node Label', true, groupNodeCustomization)}
      nodeLabelSize={number(
        'Node Label Size',
        14,
        fontSizeOption,
        groupNodeCustomization
      )}
      nodeColor={color('Node Color', '#cf4569', groupNodeCustomization)}
      nodeLabelColor={color(
        'Node Label Color',
        '#ffffff',
        groupNodeCustomization
      )}
      showEdgeLabel={boolean('Show Edge Label', true, groupEdgeCustomization)}
      edgeLabelSize={number(
        'Edge Label Size',
        14,
        fontSizeOption,
        groupEdgeCustomization
      )}
      edgeWidth={number('Edge Width', 2, widthOption, groupEdgeCustomization)}
      edgeColor={color('Edge Color', '#cf4569', groupEdgeCustomization)}
      edgeLabelColor={color(
        'Edge Label Color',
        '#000000',
        groupEdgeCustomization
      )}
    />
  ),
  {readme: {sidebar: BasicDoc}}
);
