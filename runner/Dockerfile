FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.mjs ./

RUN useradd -m runner
USER runner

ENV PORT=7070
EXPOSE 7070
CMD ["npm", "run", "start"]
