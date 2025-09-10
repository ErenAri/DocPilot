# DocPilot helper targets

.PHONY: dev-up dev-down api-tests ui-dev _venv _api _ui _kill

BACKEND_DIR := backend
FRONTEND_DIR := frontend
VENV_DIR := $(BACKEND_DIR)/venv

# Resolve python/pip inside venv for both Unix and Windows layouts
VENV_PY := $(if $(wildcard $(VENV_DIR)/bin/python),$(VENV_DIR)/bin/python,$(VENV_DIR)/Scripts/python.exe)
VENV_PIP := $(if $(wildcard $(VENV_DIR)/bin/pip),$(VENV_DIR)/bin/pip,$(VENV_DIR)/Scripts/pip.exe)

_venv:
	python -m venv $(VENV_DIR)
	"$(VENV_PIP)" install -r $(BACKEND_DIR)/requirements.txt

_api:
	"$(VENV_PY)" -m uvicorn $(BACKEND_DIR).app.main:app --reload --port 8000 --log-level info & echo $$! > .api.pid

_ui:
	cd $(FRONTEND_DIR) && npm install && npm run dev & echo $$! > ../.ui.pid

dev-up: _venv _api _ui ## Start backend and frontend in background
	@echo "API PID: $$(cat .api.pid 2>/dev/null || echo n/a)"
	@echo "UI  PID: $$(cat .ui.pid 2>/dev/null || echo n/a)"

_kill:
	-@[ -f .api.pid ] && kill $$(cat .api.pid) && rm -f .api.pid || true
	-@[ -f .ui.pid ] && kill $$(cat .ui.pid) && rm -f .ui.pid || true

dev-down: _kill ## Stop background dev processes
	@echo "Stopped dev services"

api-tests:
	@echo "Checking /health..." && curl -s http://localhost:8000/health | jq . || true
	@echo "Checking /health/db..." && curl -s http://localhost:8000/health/db | jq . || true

ui-dev:
	cd $(FRONTEND_DIR) && npm run dev

.PHONY: schema-check
schema-check:
	"$(VENV_PY)" -m backend.app.schema_check || exit 1


