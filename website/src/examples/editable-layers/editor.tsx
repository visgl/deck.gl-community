import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';

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
      // Using a client-only library (@deck.gl-community/react-editable-layers):
      // https://docusaurus.io/docs/docusaurus-core#browseronly-example-library
      <BrowserOnly>
      {()=>{
        const App = require('../../../../examples/editable-layers/editor/example');
        return <App.Example {...otherProps} />
      }}
      </BrowserOnly>
    );
  }
}

export default makeExample(EditorDemo);
