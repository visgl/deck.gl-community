import {describe, it, expect, beforeEach} from 'vitest';
import GlobalClusterLayer from '../../src/global-cluster-layer/global-cluster-layer';

describe('GlobalClusterLayer', () => {
  let testData: Array<{coordinates: [number, number]; id: number}>;

  beforeEach(() => {
    // Create test data with points around the world
    testData = [
      {coordinates: [0, 0], id: 1},
      {coordinates: [1, 1], id: 2},
      {coordinates: [2, 2], id: 3},
      {coordinates: [50, 50], id: 4},
      {coordinates: [51, 51], id: 5},
      {coordinates: [-120, 37], id: 6},
      {coordinates: [-121, 38], id: 7}
    ];
  });

  it('should export GlobalClusterLayer', () => {
    expect(GlobalClusterLayer).toBeTruthy();
  });

  it('should have correct layerName', () => {
    expect(GlobalClusterLayer.layerName).toBe('GlobalClusterLayer');
  });

  it('should have default props', () => {
    expect(GlobalClusterLayer.defaultProps).toBeTruthy();
    expect(GlobalClusterLayer.defaultProps.clusterRadius).toBeTruthy();
    expect(GlobalClusterLayer.defaultProps.clusterMaxZoom).toBeTruthy();
  });

  it('should initialize with data', () => {
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates
    });

    expect(layer).toBeTruthy();
    expect(layer.props.data).toEqual(testData);
  });

  it('should support custom cluster styling', () => {
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates,
      clusterFillColor: [255, 0, 0, 255],
      clusterTextColor: [0, 0, 0, 255],
      clusterRadiusMinPixels: 30,
      clusterRadiusMaxPixels: 80
    });

    expect(layer.props.clusterFillColor).toEqual([255, 0, 0, 255]);
    expect(layer.props.clusterTextColor).toEqual([0, 0, 0, 255]);
    expect(layer.props.clusterRadiusMinPixels).toBe(30);
    expect(layer.props.clusterRadiusMaxPixels).toBe(80);
  });

  it('should support dynamic clustering option', () => {
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates,
      dynamicClustering: true
    });

    expect(layer.props.dynamicClustering).toBe(true);
  });

  it('should support sizeByCount option', () => {
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates,
      sizeByCount: true
    });

    expect(layer.props.sizeByCount).toBe(true);
  });

  it('should support custom point styling', () => {
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates,
      pointFillColor: [0, 255, 0, 255],
      pointRadiusMinPixels: 10,
      pointRadiusMaxPixels: 25
    });

    expect(layer.props.pointFillColor).toEqual([0, 255, 0, 255]);
    expect(layer.props.pointRadiusMinPixels).toBe(10);
    expect(layer.props.pointRadiusMaxPixels).toBe(25);
  });

  it('should support custom text styling', () => {
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates,
      fontFamily: 'Arial',
      fontWeight: 'normal',
      clusterTextSize: 20
    });

    expect(layer.props.fontFamily).toBe('Arial');
    expect(layer.props.fontWeight).toBe('normal');
    expect(layer.props.clusterTextSize).toBe(20);
  });

  it('should support custom cluster radius and maxZoom', () => {
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates,
      clusterRadius: 100,
      clusterMaxZoom: 18
    });

    expect(layer.props.clusterRadius).toBe(100);
    expect(layer.props.clusterMaxZoom).toBe(18);
  });

  it('should support custom getPointId accessor', () => {
    const getPointId = (d: any) => `point-${d.id}`;
    const layer = new GlobalClusterLayer({
      id: 'test-cluster-layer',
      data: testData,
      getPosition: (d: any) => d.coordinates,
      getPointId
    });

    expect(layer.props.getPointId).toBe(getPointId);
  });
});
