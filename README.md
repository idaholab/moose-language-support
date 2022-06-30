# moose-language-support README

## Features

* Autocomplete MOOSE input files
* Syntax highlighting for MOOSE input files
* Format MOOSE input files
* C++ class snippets for MOOSE development

### Autocomplete

![autocomplete](images/autocomplete.png)

### Syntax highlighting

Add syntax highlighting and snippets to MOOSE input files in VSCode.


Syntax highlighting for:
* Valid top level blocks
* Valid sublevel blocks
* Special highlight for the ```type = TypeName``` lines
* Highlight valid Function Parser functions in parameter strings
* Highlight valid parameters for shape function family/order and element type
* Numbers and constrants (true/false)

## MOOSE

MOOSE is an opensource multiphysics finite element simulation framework, developed at Idaho National Laboratory.

Check out the [MOOSE Framework website](https://mooseframework.inl.gov) for more information.

Contributions are greatly appreciated. Please fork this repository and open a
pull request to add snippets, make grammar tweaks, etc.

## Extension Settings

This extension contributes the following settings:

### HIT format

* `languageServerMoose.formatStyleFile`: Path to a custom HIT format style file. Leave empty for default style.

## Known Issues

none
## Release Notes

This extension is currently in beta status.


### 0.3.0
Added a hover provider to show parameter and type documentation in MOOSE input files
Enabled formatting of test specs
Updated syntax highlighting for test specs

### 0.2.0
Added support for active/inactive parameters with completion, and responsive outline
Added automatic indentation, commenting, autoclosing pairs (with Max Nezdyur)
Fixed multipath completion (e.g. `[Modules/TensorMechanics/...`)

### 0.1.1
Add reduced detail outline and make it default

### 0.1.0
Document outline view for MOOSE input files

### 0.0.5
Add icon

### 0.0.3
Small fixes to the README and ignore files

### 0.0.2
Added a format provider for MOOSE input files.

### 0.0.1

This extension is a port of the `language-moose`, `autocomplete-moose`, and `moose-hit-format` Atom extensions. By Daniel Schwen.
