import * as fs from 'node:fs/promises';
import * as cp from 'child_process';
import * as path from 'path';
import { ChildProcess } from 'node:child_process';
import internal from 'node:stream';

var debug = await fs.open("/home/schwd/rpc.log", 'w');
debug.write('Started...\n');

const re = /^[Cc]ontent-[Ll]ength: (\d+)\r\n\r\n([\s\S]*)/;

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

//
// Formats a piece of data to be sent using JSONRPC
//
function preparePackage(data: string): string;
function preparePackage(data: object): string;
function preparePackage(data: unknown): string {
  let stringified;
  if (typeof data === 'string') {
    stringified = data;
  } else {
    stringified = JSON.stringify(data);
  }
  let size = stringified.length;
  let text = `Content-Length: ${size}\r\n\r\n${stringified}`;
  return text;
}

// RPC stream manager class
class RPCStreamReader {
  private buffer: string;

  constructor(stream: internal.Readable, callback: Function) {
    this.buffer = "";
    const re = /^[Cc]ontent-[Ll]ength: (\d+)\r\n\r\n([\s\S]*)/;

    stream.setEncoding('utf-8');
    stream.on("readable", () => {
      // read available data
      let data;
      while ((data = stream.read()) !== null) {
        this.buffer += data;
      }

      // try to parse the data
      while (this.buffer.length > 0) {
        const header = this.buffer.match(re);

        // do we have a complete header?
        if (!header) {
          return;
        }

        let expect = parseInt(header[1]);
        let body = header[2];

        // if we do not have enough data, we need for more to stream in
        if (body.length < expect) {
          return;
        }

        // consume as much data as we need
        callback(body.substring(0, expect));

        // put the rest into the message buffer
        this.buffer = body.substring(expect);
      }
    });
  }
}

// child process descriptor for a MOOSE executable
class LSPChildProcess {
  private process: cp.ChildProcess | null;
  private executable: MooseExecutable;
  private status: ChildStatus;
  private reader: RPCStreamReader;

  constructor(executable_: MooseExecutable, broker: LanguageSeverBroker) {
    this.process = null;
    this.status = ChildStatus.Starting; // probably unnecessary
    this.executable = executable_;

    // now spawn the process
    let child: ChildProcess = cp.spawn(executable_.path, ['--language-server'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    child.on('error', () => {
      broker.clientMessage("MOOSE language server process died.", 1)
      this.status = ChildStatus.Stopped;
    })

    // hook up the handlers
    if (child.stdout) {
      this.reader = new RPCStreamReader(child.stdout, (data) => { broker.processServerMessage(data); });
    }

    // send initialization message
    if (editor_initialization !== null) {
      let size = editor_initialization.length;
      let success = child.stdin?.write(`Content-length: ${size}\r\n\r\n${editor_initialization}\n`);
      // This will elicit a capabilities reply from the MOOSE executable.
      // Which we will intercept.
      if (success) {
        this.status = ChildStatus.Running;
      } else {
        broker.clientMessage("Unable to launch MOOSE language server process.", 1)
        this.status = ChildStatus.Stopped;
      }
    } else {
      broker.clientMessage("Haven't received an editor_initialization yet.", 1)
      this.status = ChildStatus.Starting;
    }

    // and update the child process list
    this.process = child;
  }

  write(message: string) {
    this.process?.stdin?.write(message);
  }
};

// map from MooseExecutablePath to child process
interface LSPChildProcessList { [key: MooseExecutablePath]: LSPChildProcess }

// map from message id to child process
interface LSPRequestRoutes { [key: number]: LSPChildProcess }

// canned capabilities reply
const init_reply = {
  "jsonrpc": "2.0",
  "result": {
    "capabilities": {
      "completionProvider": true,
      "definitionProvider": true,
      "documentSymbolProvider": true,
      "hoverProvider": false,
      "textDocumentSync": {
        "change": 1,
        "openClose": true
      }
    }
  }
};

// Main broker class
class LanguageSeverBroker {
  private reader: RPCStreamReader;

  constructor() {
    debug.write("LanguageSeverBroker constructor\n");

    // set up RPC reader
    this.reader = new RPCStreamReader(process.stdin, (data) => { this.processClientMessage(data); });

    // hang around forever
    let done = false;
    (function wait() {
      if (!done) setTimeout(wait, 1000);
    })();
  }

  // child process list
  children: LSPChildProcessList = {};

  // provider cache
  provider_cache: MooseExecutableCache = {};

  // request id routing (remember which message ID went to which child process, to route cancellation tokens)
  request_routing: LSPRequestRoutes = {};

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
    debug.write(`getChild ${input_path}\n`);

    let executable: MooseExecutable = await this.getMooseExecutable(input_path);

    debug.write(`found executable ${JSON.stringify(executable)}\n`);

    // check the child process list first
    if (executable.path in this.children) {
      debug.write(`found existing child\n`);
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
    debug.write('processClientMessage data:\n' + data + '\n');

    const message = JSON.parse(data);

    // cache the initialization message and send canned reply
    if (message.method == 'initialize') {
      editor_initialization = data;
      // return canned reply
      process.stdout.write(preparePackage({ ...init_reply, id: message.id }));
      this.clientMessage('cached initialization request');
      debug.write("this.clientMessage sent\n");

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
    debug.write(`uri = ${uri}\n`);
    let file;
    const file_schema = 'file://';
    if (uri) {
      const schema = uri.substring(0, file_schema.length);
      if (schema == file_schema) {
        file = uri.substring(file_schema.length);
      } else {
        // unsupported schema (maybe use fallback here)
        return;
      }
    } else {
      // missing URI alltogether (also use fallback?)
      return;
    }
    const input_path = path.dirname(file);
    debug.write(`file = ${file}\ninput_path = ${input_path}\n`);

    // get child process
    let child = await this.getChild(input_path);

    // store request route
    if ('id' in message) {
      this.request_routing[message.id] = child;
    }

    // send message
    child.write(preparePackage(data));

    // debug.write("passed to child process\n" + data + '\n');
  }

  //
  // process message from the Server
  //
  processServerMessage(data) {
    const message = JSON.parse(data);

    // intercept capabilities reply
    if ('result' in message) {
      if ('capabilities' in message.result) {
        return;
      }
    }

    // pass reply from the MOOSE executable back to the client (editor)
    debug.write("processServerMessage data:\n" + data + '\n');
    process.stdout.write(preparePackage(data));
  }

  //
  // Send a message to the client
  //
  clientMessage(msg: string, type: 1 | 2 | 3 | 4 | 5 = 3) {
    let data = preparePackage({
      jsonrpc: "2.0",
      method: 'window/showMessage',
      params: {
        type: type,
        message: msg
      }
    });

    debug.write("clientMessage:\n" + data + '\n');
    process.stdout.write(data);
    // console.log(data);
  }
}

debug.write('constructing...\n');
let broker = new LanguageSeverBroker();
