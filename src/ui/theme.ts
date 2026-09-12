import tokens from '../../docs/design/tokens.json';

/** One palette for the trusted shell and the isolated generated document. */
export const themeVariables = Object.entries(tokens.colors)
  .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  .map(([name, value]) => `--${name}:${value}`)
  .join(';');
export function applyTheme() {
  const style = document.createElement('style');
  style.textContent = `:root{${themeVariables}}`;
  document.head.appendChild(style);
  document.documentElement.dataset.design = tokens.profileId;
}
