# moose-language-support README

## Features

* Autocomplete MOOSE input files
* Syntax highlighting for MOOSE input files and `tests` specs
* Format MOOSE input files and `tests` specs
* Document outlines for MOOSE input files
* Show parameter and object documentation on mouse hover
* C++ class snippets for MOOSE development

### Autocomplete

![autocomplete](images/autocomplete1.gif)

Autocomplete block names (even with multiple levels in one block header) and parameters.

![autocomplete](images/autocomplete2.gif)

Autocomplete object names such as MeshGenerators, Variables, UserObjects, Indicators, Markers, etc.

### Document outline

![outline](images/outline.gif)

Outline of all blocks and subblocks (with their respective types). Outline respects `active` and `inactive` parameters. Autocompletion for block names in thos parameters is also supported.

### Formatting

![formatting](images/format_document.gif)

Format input files and `tests` specs with the MOOSE HIT format tool.

### Hover

![formatting](images/hover.gif)

Show class and parameter documentation strings when hovering with the mouse.

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

### 1.0.1
Update release notes.

### 1.0.0
Rewrite of the plugin using the new MOOSE language server capability. Instead of a static JSON dump the plugin
now launches a MOOSE executable with the `--language-server` option and communicates with it through LSP.
Make sure your MOOSE repository is up to date! This new approach will allow us to vastly expand autocompletion in the future.

### 0.8.0
Internal beta release for the switch over to the built-in MOOSE language server.

### 0.7.1
Make server more tolerant for restrictive binary permissions

### 0.7.0
Snippets for finite volume

### 0.6.2
Update tree-sitter-hit WASM for VSCode 1.82
### 0.6.1
Revert WASP based formatter

### 0.6.0
Additional snippets for finite volume. Improved tests syntax.

### 0.5.1
Support for the new MooseEnum item documentation strings from https://github.com/idaholab/moose/issues/23004

### 0.5.0
Added a definition provider to jump from `type` parameter values in inout files to the class registration in the source code

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
