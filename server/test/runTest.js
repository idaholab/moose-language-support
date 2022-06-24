//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

var fs = require('fs');
var assert = require('assert');
var hp = require('../out/hit_parser.js');
var Syntax = require('../out/syntax.js');

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

function testParameters() {
  var gold = { type: 'DirichletBC', variable: 'u', boundary: 'left', value: '0' };

  assert.deepEqual(p.getPathParameters('BCs/left'), gold);
  assert.deepEqual(p.getPathParameters(['BCs', 'left']), gold);

  var b = p.getBlockAtPosition({ line: 24, column: 2 });
  assert.deepEqual(p.getBlockParameters(b.node), gold);
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
  testParameters();

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

  //
  // load a MOOSE input file with an incomplete parameter
  t = fs.readFileSync('broken_param.i', 'utf8');
  // and parse it
  p.parse(t);

  // test getting a paramterlys robustly
  var b = p.getBlockAtPosition({ line: 2, column: 0 });
  assert.deepEqual(p.getBlockParameters(b.node), {
    and: 'one_more',
    existing: 'param'
  });

  //
  // Syntax tests
  var s = Syntax.Container.fromFile('pruned2.json');

  // test pruning the tree for internal purposes (i.e to prepare a small valid subset of a Syntax)
  var s3 = Syntax.Container.fromFile('pruned3.json');
  s3.prune(2);
  assert.deepEqual(JSON.stringify(s3.tree), JSON.stringify(s.tree));

  // getting a list of valid subblocks
  assert.deepEqual(s.getSubblocks([]), ['Adaptivity', 'AuxKernels']);
  assert.deepEqual(s.getSubblocks(['AuxKernels']), ['*', 'MatVecRealGradAuxKernel', 'MaterialVectorAuxKernel']);
  assert.deepEqual(s.getSubblocks(['AuxKernels', 'test']), []);
  assert.deepEqual(s.getSubblocks(['Adaptivity']), ['Indicators', 'Markers']);
  assert.deepEqual(s.getSubblocks(['Adaptivity', 'Indicators']), ['*']);

  // get a syntax node for a given path

  // getting set of parameters for a given input path
  assert.deepEqual(Object.keys(s.getParameters({ path: ['Adaptivity'] })), ['active', 'cycles_per_step']);
  assert.deepEqual(Object.keys(s.getParameters({ path: ['Adaptivity', 'Indicators', 'test'] })), [
    'active', 'family', 'inactive'
  ]);
  assert.deepEqual(Object.keys(s.getParameters({ path: ['Adaptivity', 'Indicators', 'test'], type: 'AnalyticalIndicator' })), [
    'active', 'family', 'inactive', 'block', 'control_tags'
  ]);

  // get applicable types at the given config path
  assert.deepEqual(JSON.stringify(s.getTypes(['Adaptivity', 'Markers', 'test'])), '[{"label":"ArrayMooseVariable","documentation":"Used for grouping standard field variables with the same finite element family and order","kind":25},{"label":"BoundaryMarker","documentation":"Marks all elements with sides on a given boundary for refinement/coarsening","kind":25}]');

  // test Warehouse singleton
  var w1 = Syntax.Warehouse.getInstance();
  var w2 = Syntax.Warehouse.getInstance();
  assert.equal(w1 === w2, true);

  // run an executable
  Syntax.runApp('/usr/bin/echo', ['World']);
  // done
  console.log('All passed.')
});

