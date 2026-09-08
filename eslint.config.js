// ESLint — existe por causa de um bug específico, e mira nele.
//
// Em 07/09/2026 a tela de sessão presencial passou a travar porque uma
// linha usava `preparando` onde a variável se chama `preparandoGravacao`.
// Variável livre é JavaScript válido: o bundler compilou, os 158 testes
// passaram (nenhum toca aquela tela) e o diff parecia certo — o nome está
// correto em quatro linhas vizinhas e errado na quinta. Só apareceu quando
// alguém abriu a tela.
//
// `no-undef` pega isso em segundos.
//
// A configuração é deliberadamente estreita: erro de verdade vira `error`,
// e questão de estilo fica de fora. Um linter que reclama de vírgula é um
// linter que se aprende a ignorar — e aí ele deixa de avisar do que
// importa.
const expo = require('eslint-config-expo/flat');
const babelParser = require('@babel/eslint-parser');

module.exports = [
  ...expo,
  {
    ignores: [
      'node_modules/**',
      'android/**',
      'ios/**',
      '.expo/**',
      'dist/**',
      'docs/**',            // páginas do site: HTML com script inline
      'supabase/functions/**', // Deno, outro ambiente e outros globais
    ],
  },
  {
    // Os testes rodam no Jest, que injeta `describe`, `it`, `expect` e
    // `jest` como globais. Sem declará-los, `no-undef` acusa cada linha de
    // cada teste — 577 erros de ruído escondendo os de verdade.
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly', it: 'readonly', test: 'readonly',
        expect: 'readonly', jest: 'readonly',
        beforeEach: 'readonly', afterEach: 'readonly',
        beforeAll: 'readonly', afterAll: 'readonly',
      },
    },
  },
  {
    // Parser do Babel, e não o padrão: é o Babel que compila o app de
    // verdade. O parser embutido tropeçava em FinanceiroScreen.js (JSX
    // profundo com IIFE dentro), acusando erro de sintaxe num arquivo que
    // o Metro compila sem reclamar — e um arquivo que não parseia é um
    // arquivo que o linter não protege.
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        // Sem preset: este projeto não tem `babel.config.js` (o Metro usa o
        // padrão dele), então basta habilitar a sintaxe de JSX no parser.
        babelOptions: { parserOpts: { plugins: ['jsx'] } },
      },
    },
    rules: {
      // ── O que quebra o app em produção ──────────────────────────────
      'no-undef': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      // Promessa sem tratamento foi outra família inteira de defeitos
      // deste projeto (app preso no spinner, fila de check-in travada).
      'no-async-promise-executor': 'error',

      // ── Regras de hook: dependência esquecida é bug silencioso ──────
      'react-hooks/rules-of-hooks': 'error',
      // `exhaustive-deps` fica em aviso: a base tem efeitos com `[]`
      // deliberado e documentado. Aviso informa sem bloquear.
      'react-hooks/exhaustive-deps': 'warn',

      // ── Variável não usada é sinal de código morto ou de engano ─────
      // (um `import` que sobrou, um parâmetro que se esqueceu de usar).
      // Aviso, não erro: nem todo caso é defeito.
      'no-unused-vars': ['warn', {
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],

      // ── Ruído que não ajuda nesta base ──────────────────────────────
      'no-empty': 'off',          // `catch (_) {}` é padrão aqui, e documentado
      'import/no-unresolved': 'off',
      // Aspas em texto JSX. A regra existe pra HTML, onde `"` pode
      // confundir o parser; em React Native o texto é um Text e renderiza
      // exatamente como escrito. Eram 25 dos 26 erros — o tipo de ruído
      // que faz alguém parar de olhar a saída do linter, e aí ele deixa
      // de avisar do que importa.
      'react/no-unescaped-entities': 'off',
    },
  },
];
