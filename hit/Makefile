HIT_DIR=$(MOOSE_DIR)/framework/contrib/hit
HIT_SRC = $(HIT_DIR)/parse.cc $(HIT_DIR)/lex.cc $(HIT_DIR)/braceexpr.cc
HIT_INC = $(HIT_DIR)/parse.h $(HIT_DIR)/lex.h $(HIT_DIR)/braceexpr.h

hit.js: js.cc $(HIT_SRC) $(HIT_INC)
	emcc -Os --bind -o hit.js -I$(HIT_DIR) js.cc $(HIT_SRC)

clean:
	rm -f hit.js hit.wasm
