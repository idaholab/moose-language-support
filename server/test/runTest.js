//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

var fs = require('fs');
var assert = require('assert');
var hp = require('../out/hit_parser.js');

var p = new hp.HITParser();

function testGetBlockList() {
    // get the list of all blocks
    var bl = p.getBlockList();

    // extract just the block paths
    var paths = bl.map(b => b.path);
    paths.sort();

    assert.deepEqual(paths, ["BCs", "BCs/left", "BCs/right", "Executioner", "Kernels", "Kernels/diff", "Mesh", "Outputs", "Variables", "Variables/u"]);
}

function testFindBlock() {
    // get the hit node for a specified block
    var n = p.findBlock('BCs/right');
    assert.equal(n.children[1].text, 'right');
}

function testGetPathParameters() {
    assert.deepEqual(p.getPathParameters('BCs/left'), { type: 'DirichletBC', variable: 'u', boundary: 'left', value: '0' });
}

p.onReady(() => {
    // load a simple MOOSE input file
    var t = fs.readFileSync('simple_diffusion.i', 'utf8');

    // and parse it
    p.parse(t);

    // run tests
    testGetBlockList();
    testFindBlock();
    testGetPathParameters();

    // done
    console.log('All passed.')
});