//* This file is part of the MOOSE framework
//* https://www.mooseframework.org
//*
//* Licensed under LGPL 2.1, please see LICENSE for details
//* https://www.gnu.org/licenses/lgpl-2.1.html

import * as Syntax from './syntax';
import { HITParser } from './hit_parser';

export class Validator {
    // syntax warehouse
    private syntax : Syntax.Warehouse = Syntax.Warehouse.getInstance();

    // input file parser
    private parser = new HITParser();

    // Construct a MOOSE input file validator
    constructor() {
    }
}