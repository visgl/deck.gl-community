import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

import {makeExample} from '../../components';

class EditableH3ClusterLayerDemo extends Component {
  static title = 'Editable H3 Cluster Layer';

  static code = `${GITHUB_TREE}/examples/editable-layers/editable-h3-cluster-layer`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => {
          const App = require('../../../../examples/editable-layers/editable-h3-cluster-layer/index');
          return <App.Example {...otherProps} />;
        }}
      </BrowserOnly>
    );
  }
}

export default makeExample(EditableH3ClusterLayerDemo);
