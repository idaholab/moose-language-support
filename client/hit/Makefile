HIT_DIR = $(MOOSE_DIR)/framework/contrib/hit
HIT_SRC = $(HIT_DIR)/parse.cc $(HIT_DIR)/braceexpr.cc
HIT_INC = $(HIT_DIR)/parse.h $(HIT_DIR)/braceexpr.h

WASP_DIR = $(MOOSE_DIR)/framework/contrib/wasp
WASP_INC = $(shell find $(WASP_DIR) -name "*.h")
WASP_SRC = $(wildcard $(WASP_DIR)/wasphit/*.cpp) 
WASP_SRC += $(wildcard $(WASP_DIR)/waspcore/*.cpp) 

hit.js: js.cc $(HIT_SRC) $(HIT_INC) $(WASP_INC)
	emcc -s NODEJS_CATCH_EXIT=0 -DWASP_ENABLED -Os --bind -o hit.js -I$(HIT_DIR) -I$(WASP_DIR) -Iinclude js.cc $(HIT_SRC) $(WASP_SRC)

clean:
	rm -f hit.js hit.wasm
