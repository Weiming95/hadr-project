# Single-container run (ADR-0007). One command: `docker run -p 8080:8080 <image>`.
FROM node:24-slim

WORKDIR /app

# No dependencies to install — standard library only. Copy the source.
COPY package.json ./
COPY src ./src

# Data (SQLite WAL) and published artefacts live under /app/data by default.
ENV HADR_DB=/app/data/hadr.db
ENV PORT=8080
RUN mkdir -p /app/data

EXPOSE 8080

# node:sqlite is stable in Node 24; no extra flags required.
CMD ["node", "src/main.js"]
