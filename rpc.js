var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var fs = require('fs');
var re = /^Content-length: (\d+)$/;
//const exectuable = '/home/schwd/Programs/moose/test/moose_test-opt'
var exectuable = '/Users/schwd/Programs/moose/test/moose_test-opt';
var editor_initialization = undefined;
// canned capabilities reply
var init_reply = {
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
var spawn = require('child_process').spawn;
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
process.stdin.on('readable', function () {
    var expect = undefined;
    var data;
    var header;
    while ((header = process.stdin.read()) !== null) {
        var lines = header.split('\r\n');
        if (lines.length > 1) {
            var content_length = lines[0].match(re);
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
    var cont;
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
    var _a, _b;
    // parse data and do stuff (e.g. select correct child process)
    var message = JSON.parse(data);
    // cache the initialization message and send canned reply
    if (message.method == 'initialize') {
        editor_initialization = data;
        console.log('cached initialization request');
        // return canned reply
        var init_reply_text = JSON.stringify(__assign({ id: message.id }, init_reply));
        var size_1 = init_reply_text.length;
        process.stdout.write("Content-length: ".concat(size_1, "\r\n\r\n").concat(init_reply_text, "\n"));
        return;
    }
    // drop initialized notification
    if (message.method == 'initialized') {
        return;
    }
    // check if the request has a textdocument param
    var uri = (_b = (_a = message === null || message === void 0 ? void 0 : message.params) === null || _a === void 0 ? void 0 : _a.textDocument) === null || _b === void 0 ? void 0 : _b.uri;
    var file_schema = 'file://';
    if (uri) {
        var schema = uri.substr(0, file_schema.length);
        if (schema == 'file_schema') {
            file = uri.substr(file_schema.length);
        }
    }
    // pass on to child process
    var size = data.length;
    child.stdin.write("Content-length: ".concat(size, "\r\n\r\n").concat(data, "\n"));
}
//
// process message from the Server
//
function processServerMessage(data) {
    //
    process.stdout.write(data);
}
// hang around forever
var done = false;
(function wait() {
    if (!done)
        setTimeout(wait, 1000);
})();
