module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: ['eslint:recommended', 'plugin:vue/essential'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: { 'vue/multi-word-component-names': 'off', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  ignorePatterns: ['dist/', 'node_modules/', 'react-backup-20261008/', 'test-results/', 'playwright-report/'],
}
