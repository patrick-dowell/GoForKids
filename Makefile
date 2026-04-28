.PHONY: help up down logs rebuild shell test-katago native-backend native-frontend

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
