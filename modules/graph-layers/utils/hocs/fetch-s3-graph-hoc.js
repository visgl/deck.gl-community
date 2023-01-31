// @noflow
import React, {Component} from 'react';
import {fetchJSONFromS3} from '../data/io';
import {JSONLoader} from '../../src';

const defaultLoader = data => JSONLoader({json: data});

const FetchS3GraphHOC = (url, graphLoader = defaultLoader) => {
  return WrappedComponent => {
    return class FetchHOC extends Component {
      state = {
        loading: true,
        success: undefined,
        error: undefined,
        data: undefined,
      };

      componentDidMount() {
        this.setState({
          loading: true,
          success: false,
          error: false,
        });
        fetchJSONFromS3([url]).then(
          ([data]) =>
            this.setState({
              data: graphLoader({name: url, ...data}),
              loading: false,
              success: true,
              error: undefined,
            }),
          error =>
            this.setState({
              loading: false,
              success: false,
              error,
            })
        );
      }

      render() {
        if (this.state.loading) {
          return <h3>loading</h3>;
        }
        if (this.state.error) {
          return <h3>error: {this.state.error}</h3>;
        }
        return <WrappedComponent graph={this.state.data} {...this.props} />;
      }
    };
  };
};

export default FetchS3GraphHOC;
