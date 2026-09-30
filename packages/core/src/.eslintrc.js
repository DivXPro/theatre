module.exports = {
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: `ImportDeclaration[importKind!='type'][source.value=/@dreamerbird\\u002Fstudio/]`,
        message:
          '@dreamerbird/core may not import @dreamerbird/studio modules except via type imports.',
      },
    ],
  },
}
