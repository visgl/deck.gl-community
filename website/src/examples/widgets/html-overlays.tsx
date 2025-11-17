import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/widgets/html-overlays/app';

import {makeExample} from '../../components';

class HtmlOverlaysDemo extends Component {
  static title = 'HTML Overlays';

  static code = `${GITHUB_TREE}/examples/widgets/html-overlays`;

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

export default makeExample(HtmlOverlaysDemo, {addInfoPanel: false});
