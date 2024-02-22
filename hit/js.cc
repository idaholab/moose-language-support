#include <emscripten/bind.h>

#include "parse.h"
#include "braceexpr.h"

using namespace emscripten;

std::string
process(std::string in, std::string style)
{
	auto fmt = hit::Formatter("-", style);
	return fmt.format("-", in);
}

EMSCRIPTEN_BINDINGS(my_module) {
	function("process", &process);
}
