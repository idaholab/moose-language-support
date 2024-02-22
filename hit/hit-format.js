'use babel';

import { CompositeDisposable } from 'atom';
import fs from 'fs';
import path from 'path';

export default class HitFormat {
  constructor() {
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      atom.workspace.observeTextEditors(editor => this.handleBufferEvents(editor)),
    );

    this.subscriptions.add(atom.commands.add('atom-workspace', 'hit-format:format', () => {
      const editor = atom.workspace.getActiveTextEditor();
      if (editor) {
        this.format(editor);
      }
    }));

    this.hitjs = require('./hit.js');

    this.warning = null;

    this.style = null;
    atom.config.onDidChange('moose-hit-format.styleFile', () => {
      this.style = null;
    });
  }

  destroy = () => {
    this.subscriptions.dispose();
  }

  dismissWarning = () => {
    if (this.warning === null) return;

    this.warning.dismiss();
    this.warning = null;
  }

  handleBufferEvents = (editor) => {
    const buffer = editor.getBuffer();
    const bufferSavedSubscription = buffer.onWillSave(() => {
      const scope = editor.getRootScopeDescriptor().scopes[0];
      if (atom.config.get('moose-hit-format.formatOnSave') &&
          ['input.moose', 'tests.moose'].includes(scope)) {
        buffer.transact(() => this.format(editor));
      }
    });

    const editorDestroyedSubscription = editor.onDidDestroy(() => {
      bufferSavedSubscription.dispose();
      editorDestroyedSubscription.dispose();

      this.subscriptions.remove(bufferSavedSubscription);
      this.subscriptions.remove(editorDestroyedSubscription);
    });

    this.subscriptions.add(bufferSavedSubscription);
    this.subscriptions.add(editorDestroyedSubscription);
  }

  format = (editor) => {
    if (this.style === null)
    {
      const file = atom.config.get('moose-hit-format.styleFile') || path.join(__dirname, 'default.style');
      try {
        this.style = fs.readFileSync(file);
      } catch(e) {
        atom.notifications.addError(`Failed to load style file '${file}'.`, {dismissable: true});
        return;
      }
    }

    this.dismissWarning();
    try {
      const newtext = this.hitjs.process(editor.getText(), this.style);
      editor.getBuffer().setTextViaDiff(newtext);
    } catch(e) {
      this.warning = atom.notifications.addWarning(`Malformed input.`, {dismissable: true});
      setTimeout(this.dismissWarning, 5000);
    }
  }
}
