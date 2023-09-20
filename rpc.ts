import * as fs from 'fs-plus';
import * as cp from 'child_process';
import * as path from 'path';

const re = /^Content-length: (\d+)$/
const spawn = require('child_process').spawn;

const exectuable = '/Users/schwd/Programs/moose/test/moose_test-opt'
let editor_initialization = undefined;

enum ChildStatus {
  Running,
  Stopped,
  Starting
};

interface MooseExecutable {
  path: string,
  mtime: any | null;
};
// from file path to executable
interface MooseExecutableCache = { [key: string]: MooseExecutable } [];

interface ChildProcess {
  process: any | null,
  executable: MooseExecutable,
  status: ChildStatus,
  message_queue: string[]
};
interface ChildProcessList = { [key: string]: ChildProcess } [];

class LanguageSeverBroker {
  // canned capabilities reply
  const init_reply: {
    "jsonrpc": "2.0",
    "result": {
      "capabilities": {
        "completionProvider": true,
        "definitionProvider": true,
        "documentSymbolProvider": true,
        "hoverProvider": true,
        "textDocumentSync": {
          "change": 1,
          "openClose": true
        }
      }
    }
  };

  // child process list
  children: ChildProcessList = {};

  // provider cache
  provider_cache: MooseExecutableCache = {};

  async getMooseExecutable(input_path: string): MooseExecutable {
    if (!input_path) {
      throw new Error('File not saved, nowhere to search for MOOSE executable.');
    }

    const mooseApp = /^(.*)-(opt|dbg|oprof|devel)$/;

    if (input_path in this.provider_cache) {
      return this.provider_cache[input_path];
    }

    var search_path = input_path;
    let matches: MooseExecutable[] = [];
    while (true) {
      // read directory
      let dir = await fs.readdir(search_path);

      // list all files
      for (let item of dir) {
        // check for native or WSL executable or static dump
        let match = mooseApp.exec(item);
        if (match) {
          let file = path.join(search_path, item);

          // make sure the matched path is executable
          if (!await fs.isExecutable(file)) {
            continue;
          }

          let stats = await fs.stat(file);

          // get time of last file modification
          var mtime = stats.mtime.getTime();

          matches.push({ path: file, mtime: mtime });
        }
      }

      // if any app candidates were found return the newest one
      if (matches.length > 0) {
        // return newest match (app or static dump)
        let provider = matches.reduce((a, b) => a.mtime > b.mtime ? a : b);
        this.provider_cache[input_path] = provider;
        return provider;
      }

      // go to parent
      let previous_path = search_path;
      search_path = path.join(search_path, '..');

      // are we at the top level directory already?
      if (search_path == previous_path) {
        // no executable found, let's check the fallback path
        // if (this.fallback_app_dir !== '' && input_path !== this.fallback_app_dir) {
        //   return this.getSyntaxProvider(this.fallback_app_dir);
        // }
        throw new Error('No MOOSE application executable found.');
      }
    }
  }
}

async function getChild(input_path) {
  let child: ChildProcess = {
    process: null,
    executable: this.getMooseExecutable(input_path),
    status: ChildStatus.Starting,
    message_queue: []
  };
  children.push(child);

  let process = await cp.spawn(exectuable, ['--language-server']);

  child.process = process;
  child.status = ChildStatus.Running;
}

child = spawn(exectuable, ['--language-server']);
child.stdin.setEncoding = 'utf-8';

// pass through stdout
child.stdout.on('data', processServerMessage);

//
// Hook up proxy server stdin
//

// set proper encoding
process.stdin.setEncoding('utf8');

// read stdin
process.stdin.on('readable', () => {
  let expect = undefined;
  let data;
  let header;
  while ((header = process.stdin.read()) !== null) {
    const lines = header.split('\r\n');
    if (lines.length > 1) {
      const content_length = lines[0].match(re);
      if (content_length) {
        expect = parseInt(content_length[1]);
        data = lines.slice(2).join('\r\n');
        break;
      }
    }
  }
  // input exhausted and no header found
  if (expect === undefined)
    return;

  // Use a loop to make sure we read all available data
  let cont;
  while ((cont = process.stdin.read()) !== null) {
    data += cont;
    if (data.length > expect)
      console.log("POOP!");
  }
  processClientMessage(data);
});

//
// process message from client
//
function processClientMessage(data) {
  // parse data and do stuff (e.g. select correct child process)
  const message = JSON.parse(data);

  // cache the initialization message and send canned reply
  if (message.method == 'initialize') {
    editor_initialization = data;
    console.log('cached initialization request');
    // return canned reply
    let init_reply_text = JSON.stringify({ id: message.id, ...init_reply });
    let size = init_reply_text.length;
    process.stdout.write(`Content-length: ${size}\r\n\r\n${init_reply_text}\n`);
    return;
  }

  // drop initialized notification
  if (message.method == 'initialized') {
    return;
  }

  // check if the request has a textdocument param
  let uri = message?.params?.textDocument?.uri;
  const file_schema = 'file://';
  if (uri) {
    let schema = uri.substr(0, file_schema.length);
    if (schema == 'file_schema') {
      file = uri.substr(file_schema.length);
    }
  }

  // pass on to child process
  let size = data.length
  child.stdin.write(`Content-length: ${size}\r\n\r\n${data}\n`);
}

//
// process message from the Server
//
function processServerMessage(data) {
  //
  process.stdout.write(data);
}

// hang around forever
let done = false;
(function wait() {
  if (!done) setTimeout(wait, 1000);
})();
