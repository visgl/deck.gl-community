import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {default as ExampleApp} from '../../../../examples/layers/path-marker-outline/app';

import {makeExample} from '../../components';

class PathOutlineAndMarkersDemo extends Component {
  static title = 'Path outline and marker';

  static code = `${GITHUB_TREE}/examples/layers/path-marker-outline`;

  static renderInfo() {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>{() => <ExampleApp {...otherProps} />}</BrowserOnly>
    );
  }
}

export default makeExample(PathOutlineAndMarkersDemo, {addInfoPanel: false});
