/**
 * Jest E2E 테스트 설정
 * @author 최진호
 * @date 2026-02-12
 */

module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/e2e/**/*.test.js'],
    testTimeout: 30000,
    verbose: true
};
