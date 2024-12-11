import React, {Component} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {GITHUB_TREE} from '../../constants/defaults';
import {App} from '../../../../examples/playground/src/app';

import {makeExample} from '../../components';

class AdvancedDemo extends Component {
  static title = 'Playground';

  static code = `${GITHUB_TREE}/examples/playground`;

  static renderInfo(meta) {
    return <></>;
  }

  render() {
    const {...otherProps} = this.props;

    return (
      <BrowserOnly>
        {() => (
          <div>
            <style>
              {`
    body {margin: 0; font-family: sans-serif; overflow: hidden;}
    #app {width: 100vw; height: 100vh; display: flex; flex-direction: row; align-items: stretch;}
    #left-pane {flex: 0 1 40%; display: flex; flex-direction: column; align-items: stretch;}
    #left-pane select {flex: 0 0 34px; padding: 5px 35px 5px 5px; font-size: 16px; border: 1px solid #ccc; appearance: none;}
    #editor {flex: 0 1 100%;}
    #right-pane {flex: 0 1 60%; position: relative;}
    `}
            </style>
            <App {...otherProps} />
          </div>
        )}
      </BrowserOnly>
    );
  }
}

export default makeExample(AdvancedDemo);
