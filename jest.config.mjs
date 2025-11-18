/** @type {import('jest').Config} */
const config = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  roots: ['<rootDir>/dist'],
  setupFilesAfterEnv: ['<rootDir>/dist/test/extend.js'],
  testTimeout: 60000,
}
export default config
