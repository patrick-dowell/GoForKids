.PHONY: help up down logs rebuild shell test-katago native-backend native-frontend \
        calibrate-up calibrate-up-sanity calibrate-down calibrate-status \
        calibrate calibrate-sanity

help:
	@echo "GoForKids dev commands"
	@echo ""
	@echo "  make up               Run the deployed image locally (Docker, x86 emulated)"
	@echo "  make down             Stop the local Docker stack"
	@echo "  make logs             Tail API logs"
	@echo "  make rebuild          Force a clean rebuild of the API image"
	@echo "  make shell            Shell into the running API container"
	@echo "  make test-katago      Smoke-test KataGo via /health + a sample game"
	@echo ""
	@echo "  make native-backend   Run the backend on Mac (no Docker, uses local KataGo Metal)"
	@echo "  make native-frontend  Run the Vite dev server"
	@echo ""
	@echo "  Calibration harness (feature 20 — b28 retuning):"
	@echo "  make calibrate-up         Paired backends (b20 + b28-candidate) on :8000/:8001"
	@echo "  make calibrate-up-sanity  Paired backends (BOTH b20 + b20.yaml) for Phase 0"
	@echo "  make calibrate-down       Stop the paired backends"
	@echo "  make calibrate-status     Show paired-backend status + recent log lines"
	@echo "  make calibrate RANK=15k BOARD=9 GAMES=100 [DUMP_SGF=1]"
	@echo "  make calibrate-sanity BOARD=9   Bring up sanity pair, 100-game match, tear down"

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f api

rebuild:
	docker compose build --no-cache api

shell:
	docker compose exec api sh

test-katago:
	@echo "=== /health ==="
	@curl -s http://localhost:8000/health && echo
	@echo "=== Create 9x9 30k game ==="
	@GAME=$$(curl -s -X POST http://localhost:8000/api/games -H "Content-Type: application/json" -d '{"target_rank":"30k","mode":"casual","komi":7.5,"player_color":"black","handicap":0,"board_size":9}'); \
	GAMEID=$$(echo $$GAME | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['game_id'])"); \
	echo "  gameId=$$GAMEID"; \
	curl -s -o /dev/null -X POST "http://localhost:8000/api/games/$$GAMEID/move" -H "Content-Type: application/json" -d '{"row":4,"col":4}'; \
	echo "  played (4,4) — requesting bot reply..."; \
	curl -s -X POST "http://localhost:8000/api/games/$$GAMEID/ai-move" --max-time 30 | python3 -m json.tool

native-backend:
	cd backend && ./venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

native-frontend:
	cd frontend && npm run dev


# ---------- calibration harness (feature 20) ----------
#
# Two native uvicorn backends sharing the brew KataGo binary but pointed at
# different model + profile YAML pairs. Each backend uses its own SQLite DB
# under CAL_RUN_DIR to avoid lock contention. PIDs and logs land in the same
# dir so calibrate-down / calibrate-status can find them.

KATAGO_BIN  ?= /opt/homebrew/bin/katago
KATAGO_CFG  ?= /opt/homebrew/share/katago/configs/analysis_example.cfg
KATAGO_B20  ?= /opt/homebrew/share/katago/g170e-b20c256x2-s5303129600-d1228401921.bin.gz
KATAGO_B28  ?= $(CURDIR)/backend/models/b28.bin.gz

# Calibration runs on dedicated ports (not :8000) so it doesn't collide with
# `make native-backend`. Override on the command line if these are taken.
CAL_PORT_OLD ?= 8100
CAL_PORT_NEW ?= 8101
CAL_RUN_DIR  := /tmp/goforkids-calibrate
CAL_LOG_DIR  := $(CURDIR)/data/calibration_logs_b28

# Internal helper: launch one backend in the background. Args ($1..$6):
#   $1 = label (old|new)            $2 = port
#   $3 = path to KataGo model       $4 = path to YAML profile
# Logs to $(CAL_LOG_DIR)/backend-<label>.log; PID to $(CAL_RUN_DIR)/<label>.pid.
define _calibrate_launch
	@mkdir -p $(CAL_RUN_DIR) $(CAL_LOG_DIR)
	@if [ ! -f "$(3)" ]; then echo "ERROR: KataGo model not found: $(3)"; exit 1; fi
	@if [ ! -f "$(4)" ]; then echo "ERROR: profile YAML not found: $(4)"; exit 1; fi
	@if [ ! -x "$(KATAGO_BIN)" ]; then echo "ERROR: KataGo binary not executable: $(KATAGO_BIN)"; exit 1; fi
	@echo "  backend-$(1) :$(2)  model=$$(basename $(3))  profile=$$(basename $(4))"
	@cd backend && ( \
	    KATAGO_PATH='$(KATAGO_BIN)' \
	    KATAGO_MODEL='$(3)' \
	    KATAGO_CONFIG='$(KATAGO_CFG)' \
	    CALIBRATION_PROFILE_PATH='$(4)' \
	    GOFORKIDS_DB='$(CAL_RUN_DIR)/$(1).db' \
	    nohup ./venv/bin/uvicorn app.main:app \
	        --host 127.0.0.1 --port $(2) \
	        > '$(CAL_LOG_DIR)/backend-$(1).log' 2>&1 & \
	    echo $$! > '$(CAL_RUN_DIR)/$(1).pid' \
	)
endef

# Internal helper: wait until both ports answer /health (60s timeout).
define _calibrate_wait
	@printf "Waiting for backends to come up"; \
	for i in $$(seq 1 60); do \
	    if curl -sf http://localhost:$(CAL_PORT_OLD)/health > /dev/null 2>&1 \
	       && curl -sf http://localhost:$(CAL_PORT_NEW)/health > /dev/null 2>&1; then \
	        echo " ✓ both healthy"; \
	        echo "  logs: tail -f $(CAL_LOG_DIR)/backend-{old,new}.log"; \
	        exit 0; \
	    fi; \
	    printf "."; sleep 1; \
	done; \
	echo " ✗ timed out — check $(CAL_LOG_DIR)/backend-{old,new}.log"; \
	exit 1
endef

calibrate-up:
	@echo "Bringing up paired backends (real calibration mode):"
	$(call _calibrate_launch,old,$(CAL_PORT_OLD),$(KATAGO_B20),$(CURDIR)/data/profiles/b20.yaml)
	$(call _calibrate_launch,new,$(CAL_PORT_NEW),$(KATAGO_B28),$(CURDIR)/data/profiles/b28_candidate.yaml)
	$(_calibrate_wait)

calibrate-up-sanity:
	@echo "Bringing up paired backends (Phase 0 sanity — both b20 + b20.yaml):"
	$(call _calibrate_launch,old,$(CAL_PORT_OLD),$(KATAGO_B20),$(CURDIR)/data/profiles/b20.yaml)
	$(call _calibrate_launch,new,$(CAL_PORT_NEW),$(KATAGO_B20),$(CURDIR)/data/profiles/b20.yaml)
	$(_calibrate_wait)

calibrate-down:
	@for who in old new; do \
	    pidf='$(CAL_RUN_DIR)'/"$$who".pid; \
	    if [ -f "$$pidf" ]; then \
	        pid=$$(cat "$$pidf"); \
	        if kill -0 "$$pid" 2>/dev/null; then \
	            kill "$$pid" && echo "stopped backend-$$who (pid $$pid)"; \
	            for j in 1 2 3 4 5; do \
	                kill -0 "$$pid" 2>/dev/null || break; sleep 1; \
	            done; \
	            kill -9 "$$pid" 2>/dev/null || true; \
	        else \
	            echo "backend-$$who pid $$pid not running"; \
	        fi; \
	        rm -f "$$pidf"; \
	    fi; \
	done

calibrate-status:
	@for who in old new; do \
	    pidf='$(CAL_RUN_DIR)'/"$$who".pid; \
	    if [ -f "$$pidf" ] && kill -0 $$(cat "$$pidf") 2>/dev/null; then \
	        echo "backend-$$who: pid $$(cat $$pidf) ✓"; \
	    else \
	        echo "backend-$$who: not running"; \
	    fi; \
	done
	@for who in old new; do \
	    log='$(CAL_LOG_DIR)'/"backend-$$who.log"; \
	    if [ -f "$$log" ]; then \
	        echo ""; echo "--- last 5 lines of backend-$$who ---"; \
	        tail -5 "$$log"; \
	    fi; \
	done

# Run a calibration match against whatever paired backends are currently up.
# Usage: make calibrate RANK=15k BOARD=9 GAMES=100  [DUMP_SGF=1]
calibrate:
	@: $${RANK:?Set RANK=15k or similar}
	@: $${BOARD:?Set BOARD=5|9|13|19}
	@./backend/venv/bin/python data/calibrate_b28.py \
	    --rank $(RANK) --board $(BOARD) --games $${GAMES:-30} \
	    --old-url http://localhost:$(CAL_PORT_OLD) \
	    --new-url http://localhost:$(CAL_PORT_NEW) \
	    $(if $(DUMP_SGF),--dump-sgf,)

# Phase 0 sanity check — full convenience target. Brings up the b20-vs-b20
# pair, runs a 100-game 15k match on the requested board, then tears down.
calibrate-sanity:
	@$(MAKE) --no-print-directory calibrate-up-sanity
	@trap '$(MAKE) --no-print-directory calibrate-down' EXIT INT TERM; \
	./backend/venv/bin/python data/calibrate_b28.py \
	    --rank 15k --board $${BOARD:-9} --games 100 \
	    --old-url http://localhost:$(CAL_PORT_OLD) \
	    --new-url http://localhost:$(CAL_PORT_NEW); \
	$(MAKE) --no-print-directory calibrate-down
