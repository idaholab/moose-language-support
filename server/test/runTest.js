//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

var fs = require('fs');
var assert = require('assert');
var hp = require('../out/hit_parser.js');

var p = new hp.HITParser();

function testGetBlockList(gold) {
  // get the list of all blocks
  var bl = p.getBlockList();

  // extract just the block paths
  var paths = bl.map(b => b.path);
  paths.sort();

  assert.deepEqual(paths, gold);
}

function testFindBlock() {
  // get the hit node for a specified block
  var n = p.findBlock('Executioner');
  assert.equal(p.getBlockParameter(n, 'solve_type'), "'PJFNK'");
}

function testGetBlockParameter() {
  var n = p.findBlock('BCs/right');
  var gold = { type: 'DirichletBC', variable: 'u', boundary: 'left', value: '0' };

  assert.deepEqual(p.getPathParameters('BCs/left'), gold);
  assert.deepEqual(p.getPathParameters(['BCs', 'left']), gold);
}

function testGetPathParameters() {
  assert.deepEqual(p.getPathParameters('BCs/left'), { type: 'DirichletBC', variable: 'u', boundary: 'left', value: '0' });
}

p.onReady(() => {
  //
  // load a simple MOOSE input file
  var t = fs.readFileSync('correct.i', 'utf8');
  // and parse it
  p.parse(t);

  // run tests
  testGetBlockList([['BCs'], ['BCs', 'left'], ['BCs', 'right'], ['Executioner'], ['Kernels'], ['Kernels', 'diff'], ['Mesh'], ['Outputs'], ['Variables'], ['Variables', 'u']]);
  testFindBlock();
  testGetBlockParameter();
  testGetPathParameters();

  //
  // load a more complicated MOOSE input file
  t = fs.readFileSync('multilevel.i', 'utf8');
  // and parse it
  p.parse(t);

  // run tests
  assert.deepEqual(p.getBlockAtPosition({ line: 44, column: 22 }).path, ['Modules', 'TensorMechanics', 'Master', 'block2']);
  testGetBlockList([
    ['AuxKernels'],
    ['AuxKernels', 'strain_theta'],
    ['AuxKernels', 'stress_theta'],
    ['AuxVariables'],
    ['AuxVariables', 'strain_theta'],
    ['AuxVariables', 'stress_theta'],
    ['BCs'],
    ['BCs', 'bottom'],
    ['BCs', 'left'],
    ['BCs', 'right'],
    ['BCs', 'top'],
    ['Debug'],
    ['Executioner'],
    ['GlobalParams'],
    ['Materials'],
    ['Materials', '_elastic_stress1'],
    ['Materials', '_elastic_stress2'],
    ['Materials', 'elasticity_tensor'],
    ['Mesh'],
    ['Mesh', 'block1'],
    ['Mesh', 'block2'],
    ['Mesh', 'generated_mesh'],
    ['Modules', 'TensorMechanics', 'Master'],
    ['Modules', 'TensorMechanics', 'Master', 'block1'],
    ['Modules', 'TensorMechanics', 'Master', 'block2'],
    ['Outputs']
  ]);

  //
  // load an incomplete MOOSE input file
  t = fs.readFileSync('incomplete.i', 'utf8');
  // and parse it
  p.parse(t);

  // only complete blocks are returned for now
  testGetBlockList([['Kernels'], ['Kernels', 'diff'], ['Mesh'], ['Variables'], ['Variables', 'u']]);
  // getting an incomplete block (this needs to work to make autocompletion useful, as any new block
  // the user is adding will likely be unclosed)
  assert.deepEqual(p.getBlockAtPosition({ line: 22, column: 12 }).path, ['BCs', 'left']);


  // done
  console.log('All passed.')
});