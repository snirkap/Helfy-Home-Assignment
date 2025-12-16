FROM mysql:8.0

COPY init.sql /docker-entrypoint-initdb.d/
COPY wait-and-init.sh /wait-and-init.sh

RUN chmod +x /wait-and-init.sh

ENTRYPOINT ["/wait-and-init.sh"]
