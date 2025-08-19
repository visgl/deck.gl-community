import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import App from '../../../../examples/layers/path-marker-orthographic/app';

import {makeExample} from '../../components';

class PathMarkerOrthographicDemo extends Component {
  static title = 'PathMarkerLayer in OrthographicView';

  static code = `${GITHUB_TREE}/examples/layers/path-marker-orthographic`;

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

export default makeExample(PathMarkerOrthographicDemo);
