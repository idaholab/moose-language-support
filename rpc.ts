import * as fs from 'node:fs/promises';
import * as cp from 'child_process';
import * as path from 'path';
import { ChildProcess } from 'node:child_process';

const re = /^Content-length: (\d+)$/
const spawn = require('child_process').spawn;

const exectuable = '/Users/schwd/Programs/moose/test/moose_test-opt'
let editor_initialization: string | null = null;

enum ChildStatus {
  Running,
  Stopped,
  Starting
};

// named string types
type MooseExecutablePath = string;
type InputFilePath = string;

// executable with pathe and modification time
interface MooseExecutable {
  path: MooseExecutablePath,
  mtime: number
};

// from file path to executable
interface MooseExecutableCache { [key: InputFilePath]: MooseExecutable }[];

// child process descriptor for a MOOSE executable
class LSPChildProcess {
  private process: cp.ChildProcess | null;
  private executable: MooseExecutable;
  private status: ChildStatus;
  private message_queue: string[]; // not used yet

  constructor(executable_: MooseExecutable, broker: LanguageSeverBroker) {
    this.process = null;
    this.status = ChildStatus.Starting; // probably unnecessary
    this.executable = executable_;

    // now spawn the process
    let process: ChildProcess = cp.spawn(executable_.path, ['--language-server'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    // hook up the handlers
    process.stdout?.setEncoding('utf-8');
    process.stdout?.on('data', broker.processServerMessage);

    // send initialization message
    if (editor_initialization !== null) {
      let size = editor_initialization.length;
      process.stdin?.write(`Content-length: ${size}\r\n\r\n${editor_initialization}\n`);
      // This will elicit a capabilities reply from the MOOSE executable.
      // Which we will intercept.
      this.status = ChildStatus.Running;
    } else {
      console.log("haven't received an editor_initialization yet.")
      this.status = ChildStatus.Starting;
    }

    // and update the child process list
    this.process = process;
    this.message_queue = [];
  }

  write(message: string) {
    this.process?.stdin?.write(message);
  }
};

// map from MooseExecutablePath to child process
interface LSPChildProcessList { [key: MooseExecutablePath]: LSPChildProcess }[];

// Main broker class
class LanguageSeverBroker {
  constructor() {
    // set proper encoding
    process.stdin.setEncoding('utf8');

    // read stdin
    process.stdin.on('readable', () => {
      let expect: number | undefined = undefined;
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
          console.log("unexpected message length!");
      }
      this.processClientMessage(data);
    });

    // hang around forever
    let done = false;
    (function wait() {
      if (!done) setTimeout(wait, 1000);
    })();
  }

  // canned capabilities reply
  private init_reply: {
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
  children: LSPChildProcessList = {};

  // provider cache
  provider_cache: MooseExecutableCache = {};

  // get a MOOSE executable desriptor for a given input file path
  async getMooseExecutable(input_path: InputFilePath): Promise<MooseExecutable> {
    if (!input_path) {
      throw new Error('File not saved, nowhere to search for MOOSE executable.');
    }

    const mooseApp = /^(.*)-(opt|dbg|oprof|devel)$/;

    // check the cache first
    if (input_path in this.provider_cache) {
      return this.provider_cache[input_path];
    }

    // otherwise traverse the directory tree upwards
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
          try {
            await fs.access(file, fs.constants.X_OK);
          } catch {
            continue;
          }

          let stats = await fs.stat(file);

          // get time of last file modification
          let mtime: number = stats.mtime.getTime();

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

  async getChild(input_path: InputFilePath): Promise<LSPChildProcess> {
    let executable: MooseExecutable = await this.getMooseExecutable(input_path);

    // check the child process list first
    if (executable.path in this.children) {
      return this.children[executable.path];
    }

    // insert entry for starting child process (allows the queue to get populated until the process is up)
    let child = new LSPChildProcess(executable, this);
    this.children[executable.path] = child;
    return child;
  }

  //
  // process message from client
  //
  async processClientMessage(data) {
    // parse data and do stuff (e.g. select correct child process)
    const message = JSON.parse(data);

    // cache the initialization message and send canned reply
    if (message.method == 'initialize') {
      editor_initialization = data;
      console.log('cached initialization request');
      // return canned reply
      let init_reply_text = JSON.stringify({ ...this.init_reply, id: message.id });
      let size = init_reply_text.length;
      process.stdout.write(`Content-length: ${size}\r\n\r\n${init_reply_text}\n`);
      return;
    }

    // drop initialized notification
    if (message.method == 'initialized') {
      return;
    }

    // quit the server
    if (message.method == 'exit') {
      process.exit();
    }

    // check if the request has a textdocument param
    let uri = message?.params?.textDocument?.uri;
    let file;
    const file_schema = 'file://';
    if (uri) {
      let schema = uri.substr(0, file_schema.length);
      if (schema == 'file_schema') {
        file = uri.substr(file_schema.length);
      } else {
        // unsupported schema (maybe use fallback here)
        return;
      }
    } else {
      // missing URI alltogether (also use fallback?)
      return;
    }

    // pass on to child process
    let child: LSPChildProcess = await this.getChild(file);
    let size = data.length
    child.write(`Content-length: ${size}\r\n\r\n${data}\n`);
  }

  //
  // process message from the Server
  //
  processServerMessage(data) {
    // pass reply from the MOOSE executable straight back to the client (editor)

    // intercept capabilities reply
    const message = JSON.parse(data);
    if ('capabilities' in message.result) {
      return;
    }

    process.stdout.write(data);
  }

}

let broker = new LanguageSeverBroker();
