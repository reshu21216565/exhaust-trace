import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', 'frontend/**']
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/analysis/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@exhausttrace/simulation', '../simulation/*'],
              message: 'Architecture violation: Analysis MUST NOT depend on Simulation (hidden ground truth).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/observation/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@exhausttrace/analysis'],
              message: 'Observation should not depend on Analysis.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/**/*.ts', 'frontend/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@exhausttrace/simulation'],
              message: 'Architecture violation: Frontend MUST NOT depend on Simulation (hidden ground truth).',
            },
          ],
        },
      ],
    },
  }
);
