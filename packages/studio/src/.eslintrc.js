module.exports = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `ImportDeclaration[importKind!='type'][source.value=/@toy-box\\u002Fcore\\u002F/]`,
        message:
          '@toy-box/studio may not import @toy-box/core/* modules except via type imports.',
      },
    ],
  },
}
