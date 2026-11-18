import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'release/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'blob-report/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts', '*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.vue'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    files: ['scripts/**/*.mjs', 'tests/fixtures/**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    files: ['tests/fixtures/**/*.cjs'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-self-closing': 'off',
      'vue/singleline-html-element-content-newline': 'off'
    }
  },
  {
    files: ['**/*.vue'],
    rules: {
      // Core rule false-positives on values consumed only by the template.
      'no-useless-assignment': 'off'
    }
  }
)
