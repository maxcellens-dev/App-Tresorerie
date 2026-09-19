/** Marketing tokens are isolated from the application's financial screens. */
export function landingTheme(dark: boolean, accent: string) {
  return {
    bg: dark ? '#102B28' : '#FAFBF8', surface: dark ? '#183B36' : '#FFFFFF',
    soft: dark ? '#21473F' : '#EDF3EE', ink: dark ? '#F2F6F1' : '#163D39',
    muted: dark ? '#B9CCC3' : '#536B65', line: dark ? '#36574E' : '#DCE5DD',
    accent, positive: dark ? '#83DEAD' : '#21714F', deep: '#123B37', white: '#F5F8F2',
  };
}
export type LandingColors = ReturnType<typeof landingTheme>;
