import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/widgets/react-widgets/app';

import {makeExample} from '../../components';

class ReactWidgetsDemo extends Component {
  static title = 'React Widgets';

  static code = `${GITHUB_TREE}/examples/widgets/react-widgets`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return <BrowserOnly>{() => <App {...otherProps} />}</BrowserOnly>;
  }
}

export default makeExample(ReactWidgetsDemo, {addInfoPanel: false});
