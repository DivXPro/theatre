module.exports = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `ImportDeclaration[importKind!='type'][source.value=/@toy-box\\u002Fstudio/]`,
        message:
          '@toy-box/core may not import @toy-box/studio modules except via type imports.',
      },
    ],
  },
}
