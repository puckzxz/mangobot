FROM ghcr.io/puppeteer/puppeteer:20.8.0
WORKDIR /app
# Install dependencies
COPY --chown=pptruser:pptruser package*.json pnpm-lock.yaml .env ./
RUN sudo npm install -g pnpm
RUN pnpm install

# Copy app files
COPY --chown=pptruser:pptruser . . 

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash

#Build Typescript code to Javascript
RUN bun prisma generate

# Expose port 3000
EXPOSE 3000

# Define the startup command
CMD ["bun", "src/index.ts"]