module.exports = {
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
  rules: {
    'no-console': 'warn',
    'no-unused-vars': 'warn',
    'eqeqeq': 'error',
    'curly': 'warn',
  },
  ignores: ['node_modules/**', 'build/**', 'migrations/**'],
};
