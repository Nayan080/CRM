import { baseConfig } from '@crm/config/eslint';

export default [
  ...baseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // Architecture rule (docs/ARCHITECTURE.md §6): only infra/prisma may touch the raw
    // database client. Domain modules must use the (tenant-scoped) PrismaService.
    files: ['src/**/*.ts'],
    ignores: ['src/infra/prisma/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@crm/db',
              message: 'Import PrismaService from src/infra/prisma instead of the raw client.',
            },
          ],
        },
      ],
    },
  },
  {
    // NestJS uses classes with decorators; DI needs runtime type imports in constructors.
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
