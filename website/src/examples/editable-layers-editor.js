import React, {Component} from 'react';
import {GITHUB_TREE} from '../constants/defaults';
import {Example as App} from 'examples/editable-layers/editor/example';

import {makeExample} from '../components';

class EditorDemo extends Component {
  static title = 'Editor';

  static code = `${GITHUB_TREE}/examples/editable-layers/editor`;

  static renderInfo(meta) {
    return (
      <>
      </>
    );
  }

  render() {
    const {params, ...otherProps} = this.props;

    return (
      <App
        {...otherProps}
      />
    );
  }
}

export default makeExample(EditorDemo);