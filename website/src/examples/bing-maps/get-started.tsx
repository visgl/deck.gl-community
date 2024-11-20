import React, {Component, useEffect} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {exampleApplication} from '../../../../examples/bing-maps/get-started/app';

import {makeExample} from '../../components';

class AdvancedDemo extends Component {
  static title = 'Bing Maps as deck.gl Basemap';

  static code = `${GITHUB_TREE}/examples/bing-maps/get-started`;

  static renderInfo(meta) {
    return <></>;
  }

  componentDidMount(): void {
    exampleApplication();
  }

  render() {
    const {...otherProps} = this.props;

    // useEffect(() => exampleApplication(), []);

    return (
      <BrowserOnly>
        {() => <div {...otherProps} />}
      </BrowserOnly>
    );
  }
}

export default makeExample(AdvancedDemo);
