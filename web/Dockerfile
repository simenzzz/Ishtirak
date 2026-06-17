FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev vite
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["npx", "vite", "preview", "--host", "--port", "3000"]
