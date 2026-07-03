// Jest — ciblé UNIQUEMENT sur les moteurs PURS (lib/*), en TypeScript via ts-jest.
// N'inclut aucun composant React Native (pas de jest-expo/babel) → rapide et isolé.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
};
