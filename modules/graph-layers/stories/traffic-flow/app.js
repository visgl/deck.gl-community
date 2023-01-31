import React, {Component} from 'react';
import {scaleLinear} from 'd3-scale';
import styled from 'styled-components';
import {window} from 'global';

import GraphGL, {JSONLoader, NODE_TYPE, EDGE_DECORATOR_TYPE} from '../../src';
import {fetchJSONFromS3} from '../../utils/data/io';
import FlowForceLayout from './flow-force-layout';
import Clock from './clock';

const AppWrapper = styled.div`
  width: 100%;
  background: black;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
`;

const ClockWrapper = styled.div`
  position: absolute;
  top: 40;
  left: 70;
`;

const DATA_PATH = 'traffic-flow-simplified.json';
const MAX_HOUR = 24;
const ANIMATION_DURATION = 3000;
const NODE_SIZE = 0.05;
const PATH_WIDTH = 0.2;
const FLOW_WIDTH = 3;
const OFFSET_SCALAR = 2;
const SPEED_RANGE = [10, 30, 60];

const ViewControlPlaceholder = () => <div />;
const Identical = n => n;
export default class TrafficFlow extends Component {
  state = {
    graph: null,
    selectedTime: 0,
    flows: [],
  };

  componentDidMount() {
    fetchJSONFromS3([DATA_PATH]).then(([json]) => {
      this._speedScale = scaleLinear()
        .range([0, 0.5, 1.5])
        .domain(SPEED_RANGE);
      this._colorScale = scaleLinear()
        .range(['#0f4', '#0af', '#0ff'])
        .domain(SPEED_RANGE);
      this.setState({
        graph: JSONLoader({
          json,
          nodeParser: Identical,
          edgeParser: Identical,
        }),
        flows: json.flows,
      });
      // start animation
      this._lastAnimation = null;
      this.animate();
    });
  }

  componentWillUnmount() {
    window.cancelAnimationFrame(this._animation);
  }

  animate = now => {
    if (!this._lastAnimation && !!this._lastClock) {
      // initialize
      this._lastAnimation = now;
    }
    if (now - this._lastAnimation >= ANIMATION_DURATION) {
      this._lastAnimation = now;
      this.setState({selectedTime: (this.state.selectedTime + 1) % MAX_HOUR});
    }

    this._animation = window.requestAnimationFrame(this.animate);
  };

  getEdgeFlow = (flowObject, edgeID) => {
    if (!flowObject || !flowObject.flow[edgeID]) {
      return undefined;
    }
    return flowObject.flow[edgeID];
  };

  render() {
    if (!this.state.graph) {
      return <h3>loading...</h3>;
    }
    const flowObject = this.state.flows[this.state.selectedTime];

    return (
      <AppWrapper>
        <ClockWrapper>
          <Clock hour={this.state.selectedTime} />
        </ClockWrapper>
        <GraphGL
          initialViewState={{
            target: [744.6151659595491, 536.3824480651981],
            zoom: 1.288,
          }}
          graph={this.state.graph}
          ViewControlComponent={ViewControlPlaceholder}
          layout={
            new FlowForceLayout({
              offsetScalar: OFFSET_SCALAR,
              speedScale: this._speedScale,
              getCurrentFlows: () => flowObject.flow || {},
            })
          }
          nodeStyle={[
            {
              type: NODE_TYPE.CIRCLE,
              radius: NODE_SIZE,
              fill: 'white',
            },
          ]}
          edgeStyle={{
            stroke: 'white',
            strokeWidth: PATH_WIDTH,
            decorators: [
              {
                type: EDGE_DECORATOR_TYPE.FLOW,
                speed: edge => {
                  const edgeFlow = this.getEdgeFlow(flowObject, edge.id);
                  return edgeFlow ? this._speedScale(+edgeFlow.mean) : 0;
                },
                color: edge => {
                  const edgeFlow = this.getEdgeFlow(flowObject, edge.id);
                  return edgeFlow ? this._colorScale(+edgeFlow.mean) : '#000';
                },
                width: FLOW_WIDTH,
                tailLength: 2,
              },
            ],
          }}
        />
      </AppWrapper>
    );
  }
}
