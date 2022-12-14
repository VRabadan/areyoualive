all: start

start:
	docker-compose -f docker-compose.yml up

startinbg:
	docker-compose -f docker-compose.yml up -d

stop:
	docker-compose -f docker-compose.yml stop

restart:
	docker-compose -f docker-compose.yml restart

down:
	docker-compose -f docker-compose.yml down

sh:
	docker-compose -f docker-compose.yml exec areyoualive bash

logs:
	docker-compose -f docker-compose.yml logs --tail 250 -f

build:
	docker-compose -f docker-compose.yml build --no-cache --progress plain

rm:
	docker-compose -f docker-compose.yml down --rmi local

.PHONY: all start startinbg stop restart down sh logs build rm
