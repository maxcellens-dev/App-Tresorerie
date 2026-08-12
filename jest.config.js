// Jest — DEUX projets, volontairement séparés.
//
//  • « lib »        : les moteurs PURS (lib/*), en environnement node, sans babel ni react-native.
//                     C'est ce qui les garde à ~2 s : la boucle de travail reste instantanée.
//  • « components » : les écrans et composants, via jest-expo (donc babel + doublures natives).
//                     Nettement plus lent, et surtout plus fragile — d'où l'isolement : une panne
//                     d'infrastructure côté composants n'aveugle pas la couverture métier.
//
// `npm test` lance les deux. Pour la boucle rapide pendant qu'on travaille sur du calcul :
//     npx jest --selectProjects lib
module.exports = {
  projects: [
    {
      displayName: 'lib',
      testEnvironment: 'node',
      // Uniquement les `.test.ts` : les `.test.tsx` appartiennent à l'autre projet.
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
      },
    },
    {
      displayName: 'components',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
      // jest-expo ne transpile pas node_modules par défaut : les paquets Expo/RN sont publiés en
      // ESM/JSX non compilé et doivent passer par babel, sinon chaque import lève au chargement.
      transformIgnorePatterns: [
        'node_modules/(?!(?:jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@tanstack/.*)',
      ],
    },
  ],
};
