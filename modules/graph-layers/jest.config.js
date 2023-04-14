export default {
  roots: ['./src'],
  collectCoverageFrom: ['./src/**/*.js'],
  setupFilesAfterEnv: ['./test/utils/setup-tests.js'],
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest'
  },
  moduleNameMapper: {
    '^d3-(.*)': '<rootDir>/../../node_modules/d3-$1/dist/d3-$1.js'
  }
};
