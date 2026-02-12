import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/widgets/pan-and-zoom-controls/app';

import {makeExample} from '../../components';

class PanAndZoomControlsDemo extends Component {
  static title = 'Pan and Zoom Controls';

  static code = `${GITHUB_TREE}/examples/widgets/pan-and-zoom-controls`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>{() => <App {...otherProps} />}</BrowserOnly>
    );
  }
}

export default makeExample(PanAndZoomControlsDemo, {addInfoPanel: false});
