import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/dag-aligned/src/example';

import {makeExample} from '../../components';

class DagAlignedDemo extends Component {
  static title = 'Rank-Aligned DAG Layout';

  static code = `${GITHUB_TREE}/examples/dag-aligned`;

  static renderInfo() {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return <BrowserOnly>{() => <App {...otherProps} />}</BrowserOnly>;
  }
}

export default makeExample(DagAlignedDemo);
