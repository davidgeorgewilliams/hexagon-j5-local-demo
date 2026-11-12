.PHONY: up down logs test test-browser status
up:
	docker compose up --build -d --wait

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

status:
	docker compose ps

test:
	docker compose --profile test run --build --rm api-tests

test-browser:
	./scripts/test-browser.sh
