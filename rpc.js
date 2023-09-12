const fs = require('fs');
const re = /^Content-length: (\d+)$/

//const exectuable = '/home/schwd/Programs/moose/test/moose_test-opt'
const exectuable = '/Users/schwd/Programs/moose/test/moose_test-opt'
let editor_initialization = undefined;

// canned capabilities reply
const init_reply = {
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

//
// launch and hook up child process
//
const spawn = require('child_process').spawn;
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
