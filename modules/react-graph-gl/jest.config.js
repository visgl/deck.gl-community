export default {
  collectCoverageFrom: ['src/**/*.js'],
  coveragePathIgnorePatterns: ['__fixtures__', 'stories'],
  testPathIgnorePatterns: ['/node_modules/', '.cache'],
  transformIgnorePatterns: ['node_modules/(?!(gatsby)/)'],
  setupFilesAfterEnv: ['./utils/setup-tests.js'],
  moduleNameMapper: {
    d3: '<rootDir>/node_modules/d3/dist/d3.min.js'
  },
  testEnvironment: 'jsdom'
};
