.PHONY: demo frontend backend seed test test-frontend test-backend build export-data

demo: frontend

frontend:
	cd frontend && npm install && npm run dev

backend:
	. .venv/bin/activate && cd backend && python manage.py runserver

seed:
	. .venv/bin/activate && cd backend && python manage.py migrate && python manage.py seed_demo

export-data:
	.venv/bin/python scripts/export_demo_dataset.py

test: test-backend test-frontend

test-backend:
	. .venv/bin/activate && cd backend && pytest -q

test-frontend:
	cd frontend && npm test -- --run

build:
	cd frontend && npm run build
