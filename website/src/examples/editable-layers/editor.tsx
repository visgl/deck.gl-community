import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {Example as App} from '../../../../examples/editable-layers/editor/example';

import {makeExample} from '../../components';

class EditorDemo extends Component {
  static title = 'Editor';

  static code = `${GITHUB_TREE}/examples/editable-layers/editor`;

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

export default makeExample(EditorDemo);
