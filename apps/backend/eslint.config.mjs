import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'jest.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      // sql.raw() bypasses parameter binding. Allowed only in migrations, which contain no user input.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
          message: 'sql.raw() is forbidden outside migrations: it can enable SQL injection.',
        },
      ],
    },
  },
  {
    files: ['src/database/migrations/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
