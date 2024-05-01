import React, {Component} from 'react';
import {GITHUB_TREE} from '../constants/defaults';
import App from 'examples/editable-layers/advanced/src/example';

import {makeExample} from '../components';

class AdvancedDemo extends Component {
  static title = 'Advanced';

  static code = `${GITHUB_TREE}/examples/editable-layers/advanced`;

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

export default makeExample(AdvancedDemo);