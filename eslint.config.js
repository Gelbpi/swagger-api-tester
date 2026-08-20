// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/test/**', 'target/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Mandatory dependency direction: src/engine must never import src/mcp.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mcp/**', '**/mcp', '@modelcontextprotocol/*'],
              message:
                'Architecture violation: src/engine must not depend on src/mcp or the MCP SDK. Dependency direction is mcp -> engine only.',
            },
          ],
        },
      ],
    },
  },
);
