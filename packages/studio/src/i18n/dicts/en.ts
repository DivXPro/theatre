/**
 * studio 内置英文词条(基准语言,key 的权威定义在此)。
 * 平铺点分键;同一 key 宿主可后注册覆盖(品牌定制)。
 */
import type {Messages} from '@dreamerbird/studio/i18n/core'

export const en: Messages = {
  'toolbar.outline.tooltip': 'Outline',
  'toolbar.outline.conflict.one':
    'There is a state conflict in project "{projectId}". Select the project in the outline below in order to fix it.',
  'toolbar.outline.conflict.many':
    'There are {count} projects that have state conflicts. They are highlighted in the outline below.',
  'menu.whatsNew': "What's new?",
  'menu.chatWithUs': 'Chat with us',
  'menu.help': 'Help',
  'menu.settings': 'Settings',
  'menu.docs': 'Docs',
  'menu.changelog': 'Changelog',
  'menu.github': 'Github',
  'menu.twitter': 'Twitter',
  'menu.discord': 'Discord',
  'menu.version': 'Version',
  'menu.language': 'Language',
  'detailPanel.propsRoot': 'Props',
}
