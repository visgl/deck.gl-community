import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/widgets/widget-panels/app';

import {makeExample} from '../../components';

class WidgetPanelsDemo extends Component {
  static title = 'Widget Panels';

  static code = `${GITHUB_TREE}/examples/widgets/widget-panels`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return <BrowserOnly>{() => <App {...otherProps} />}</BrowserOnly>;
  }
}

export default makeExample(WidgetPanelsDemo, {addInfoPanel: false});
