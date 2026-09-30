module.exports = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `ImportDeclaration[importKind!='type'][source.value=/@dreamerbird\\u002Fcore\\u002F/]`,
        message:
          '@dreamerbird/studio may not import @dreamerbird/core/* modules except via type imports.',
      },
    ],
  },
}
