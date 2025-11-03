import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/graph-layers/graph-viewer/app';

import {makeExample} from '../../components';

class GraphViewerDemo extends Component {
  static title = 'Simple Graph Viewer';

  static code = `${GITHUB_TREE}/examples/graph-layers/graph-viewer`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => <App {...otherProps} />}
      </BrowserOnly>
    );
  }
}

export default makeExample(GraphViewerDemo);
