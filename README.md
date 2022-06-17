# moose-language-support README

## Features
Add syntax highlighting and snippets to MOOSE input files in VSCode.

![syntax highlighting](images/syntax.png)

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

### 0.0.2
Added a format provider for MOOSE input files.
### 0.0.1

This extension is a port of the `language-moose`, `autocomplete-moose`, and `moose-hit-format` Atom extensions. By Daniel Schwen.
