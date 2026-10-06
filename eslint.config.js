// ESLint 9 flat config —— 见 docs/code-review/TOOLING.md 的安装说明
// 设计原则：只启用"不需要类型信息"的规则，避免与 TypeScript 版本耦合；
// 存量债务（any / 非空断言）先设为 warn 记账，新增代码靠 CODE_REVIEW.md §6-T 人工守。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'integrations/**',
      'public/infinite-canvas/**',
      'data/**',
      'coverage/**',
      '**/*.js',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        Image: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
      },
    },
    rules: {
      // —— 正确性 ——
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'smart'],
      'no-implicit-coercion': 'error',
      'no-return-await': 'error',
      'require-atomic-updates': 'error',
      'no-async-promise-executor': 'error',
      'no-unsafe-finally': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // —— 存量债务：记账但不阻断，数量只减不增 ——
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',

      // —— 可观测性：禁止调试残留 ——
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-alert': 'error',

      // —— React Hooks（对应 CODE_REVIEW.md §6-F） ——
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    // 测试文件放宽：允许 any 与断言，专注行为断言
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
