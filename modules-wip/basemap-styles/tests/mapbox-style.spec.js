import {filterFeatures} from '../src/mapbox-style';

describe('filterFeatures', () => {
  describe('filter geometry correctly', () => {
    describe('filter using geometry.type', () => {
      test('filter true Point', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Point', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true LineString', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false LineString', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true Polygon', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Polygon',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Polygon', () => {
        const features = [
          {
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: []
            },
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
    });

    describe('filter using provided numeric type', () => {
      test('filter true Point', () => {
        const features = [
          {
            type: 1,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Point', () => {
        const features = [
          {
            type: 2,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Point'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true LineString', () => {
        const features = [
          {
            type: 2,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false LineString', () => {
        const features = [
          {
            type: 1,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'LineString'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
      test('filter true Polygon', () => {
        const features = [
          {
            type: 3,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual(features);
      });
      test('filter false Polygon', () => {
        const features = [
          {
            type: 1,
            properties: {
              class: 'minor'
            }
          }
        ];
        const filter = ['==', '$type', 'Polygon'];
        const result = filterFeatures({features, filter});
        expect(result).toStrictEqual([]);
      });
    });
  });
});
