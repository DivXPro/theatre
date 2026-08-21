const path = require('path')

module.exports = {
  rules: {
    'no-relative-imports': [
      'warn',
      {
        aliases: [
          {name: '@toy-box/core', path: path.resolve(__dirname, '../core/src')},
          {
            name: '@toy-box/studio',
            path: path.resolve(__dirname, './src'),
          },
        ],
      },
    ],
  },
}
