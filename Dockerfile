FROM ghcr.io/puppeteer/puppeteer:19.11.1
WORKDIR /app
# Install dependencies
COPY --chown=pptruser:pptruser package*.json yarn.lock .env ./
RUN yarn

# Copy app files
COPY --chown=pptruser:pptruser . . 

# Install Bun
RUN npm install bun

# Reload bash
RUN exec bash

#Build Typescript code to Javascript
RUN yarn prisma generate

# Expose port 3000
EXPOSE 3000

# Define the startup command
CMD ["./start.sh"]