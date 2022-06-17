'use babel';

import HitFormat from './hit-format';

export default {
  config: {
    formatOnSave: {
      type: 'boolean',
      default: false,
      title: 'Format on save',
      order: 1,
    },
    styleFile: {
      type: 'string',
      default: '',
      order: 8,
      description: 'Default "file" uses the file ".hit-format" in one of the parent directories of the source file.',
    },
  },

  activate() {
    this.hitFormat = new HitFormat();
  },

  deactivate() {
    return this.hitFormat.destroy();
  },
};
