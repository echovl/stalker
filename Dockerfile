FROM node:18.14.1-buster

# Update system
RUN apt-get update && apt-get install -y apt-transport-https

ENV NODE_OPTIONS --max-old-space-size=4096

WORKDIR /app

# Install node dependencies
COPY .gitignore .gitignore
COPY package.json package.json
COPY pnpm-lock.yaml pnpm-lock.yaml
RUN npm i -g pnpm && pnpm install

# Copy whole project and build
COPY . .

RUN pnpm build

CMD [ "node", "./build/index.js" ]
